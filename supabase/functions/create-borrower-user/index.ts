import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function appError(message: string, details?: Record<string, unknown>) {
  return json({ error: message, ...(details || {}) }, 200);
}

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function jwtPayload(token: string) {
  try {
    const part = token.split(".")[1] || "";
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (_err) {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return appError("Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return appError("Missing Supabase Edge Function environment variables.");
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return appError("Missing admin session. Sign out and sign back in as admin.");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: callerData, error: callerError } = await userClient.auth.getUser(token);
  const caller = callerData?.user;
  if (callerError || !caller) return appError("Invalid admin session. Sign out and sign back in as admin.");

  const aal = jwtPayload(token)?.aal;
  if (aal !== "aal2") return appError("Please complete admin 2FA before creating portal users.");

  const { data: adminRows, error: adminError } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", caller.id)
    .limit(1);
  if (adminError) return appError("Could not verify admin access.");
  if (!adminRows?.length) return appError("Admin access required.");

  let body: { action?: string; borrowerId?: string; email?: string; redirectTo?: string } = {};
  try {
    body = await req.json();
  } catch (_err) {
    return appError("Invalid JSON body.");
  }

  const action = String(body.action || "create-user").trim();
  const borrowerId = String(body.borrowerId || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const redirectTo = String(body.redirectTo || "").trim() || undefined;
  if (!borrowerId) return appError("Missing borrower ID.");

  const { data: borrower, error: borrowerError } = await adminClient
    .from("borrowers")
    .select("id, name, email, auth_user_id")
    .eq("id", borrowerId)
    .single();
  if (borrowerError || !borrower) return appError("Borrower not found.");

  async function linkedUserIsAdmin(userId: string) {
    const { data, error } = await adminClient
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .limit(1);
    if (error) return true;
    return Boolean(data?.length);
  }

  if (action === "set-temporary-password") {
    if (!borrower.auth_user_id) return json({ error: "Borrower does not have a linked portal user." }, 200);
    if (await linkedUserIsAdmin(borrower.auth_user_id)) {
      return json({ error: "Refusing to change password: this borrower is linked to an admin user ID. Fix the Borrower Portal User ID first." }, 200);
    }
    const tempPassword = randomPassword();
    const { data: updated, error: updateUserError } = await adminClient.auth.admin.updateUserById(
      borrower.auth_user_id,
      { password: tempPassword }
    );
    if (updateUserError || !updated?.user) {
      return json({ error: updateUserError?.message || "Could not set temporary password." }, 200);
    }
    return json({
      userId: updated.user.id,
      email: updated.user.email,
      tempPassword,
      message: "Temporary password set."
    });
  }

  if (action !== "create-user") return appError("Unknown action.");
  if (!email || !email.includes("@")) return appError("Borrower email is required.");
  if (borrower.auth_user_id && await linkedUserIsAdmin(borrower.auth_user_id)) {
    return json({ error: "Refusing to use this borrower link: Borrower Portal User ID belongs to an admin user." }, 200);
  }
  if (borrower.auth_user_id) {
    return json({
      userId: borrower.auth_user_id,
      alreadyLinked: true,
      message: "Borrower already has a linked portal user."
    });
  }

  const tempPassword = randomPassword();
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      role: "borrower",
      borrower_id: borrowerId,
      name: borrower.name || ""
    }
  });

  if (createError || !created?.user) {
    const message = createError?.message || "Could not create portal user.";
    const status = /already|registered|exists/i.test(message) ? 409 : 400;
    return appError(message, {
      hint: status === 409 ? "That email may already exist in Supabase Auth. If you still see Alex in Authentication → Users, copy that Auth UID into Borrower Portal User ID instead of creating a new user." : undefined
    });
  }

  const { error: updateError } = await adminClient
    .from("borrowers")
    .update({ email, auth_user_id: created.user.id })
    .eq("id", borrowerId);

  if (updateError) {
    return appError("Portal user was created, but borrower linking failed. Copy this user ID into the borrower manually.", {
      userId: created.user.id,
      tempPassword
    });
  }

  let resetLink = "";
  if (redirectTo) {
    const { data: linkData } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo }
    });
    resetLink = linkData?.properties?.action_link || "";
  }

  return json({
    userId: created.user.id,
    email,
    tempPassword,
    resetLink,
    message: "Borrower portal user created and linked."
  });
});
