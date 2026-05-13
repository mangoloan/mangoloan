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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Missing Supabase Edge Function environment variables." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing admin session." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: callerData, error: callerError } = await userClient.auth.getUser(token);
  const caller = callerData?.user;
  if (callerError || !caller) return json({ error: "Invalid admin session." }, 401);

  const aal = jwtPayload(token)?.aal;
  if (aal !== "aal2") return json({ error: "Please complete admin 2FA before creating portal users." }, 403);

  const { data: adminRows, error: adminError } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", caller.id)
    .limit(1);
  if (adminError) return json({ error: "Could not verify admin access." }, 500);
  if (!adminRows?.length) return json({ error: "Admin access required." }, 403);

  let body: { borrowerId?: string; email?: string; redirectTo?: string } = {};
  try {
    body = await req.json();
  } catch (_err) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const borrowerId = String(body.borrowerId || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const redirectTo = String(body.redirectTo || "").trim() || undefined;
  if (!borrowerId) return json({ error: "Missing borrower ID." }, 400);
  if (!email || !email.includes("@")) return json({ error: "Borrower email is required." }, 400);

  const { data: borrower, error: borrowerError } = await adminClient
    .from("borrowers")
    .select("id, name, email, auth_user_id")
    .eq("id", borrowerId)
    .single();
  if (borrowerError || !borrower) return json({ error: "Borrower not found." }, 404);
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
    return json({
      error: message,
      hint: status === 409 ? "That email may already exist in Supabase Auth. Link the existing user manually, or use a different email." : undefined
    }, status);
  }

  const { error: updateError } = await adminClient
    .from("borrowers")
    .update({ email, auth_user_id: created.user.id })
    .eq("id", borrowerId);

  if (updateError) {
    return json({
      error: "Portal user was created, but borrower linking failed. Copy this user ID into the borrower manually.",
      userId: created.user.id,
      tempPassword
    }, 500);
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
