# Mango Loan Updates — 2026-05-14

## Borrower/admin portal usability

- Added automated **Create Portal User** button in admin so portal users can be created without manually copying Supabase Auth UUIDs.
- Added Supabase Edge Function: `supabase/functions/create-borrower-user/index.ts`.
- Deployed Edge Function to Supabase project `ensuvkedfzepbpipivgp`.
- Added **Set Temporary Password** for linked borrower portal users.
- Added safety guard so temporary-password tools do **not** change users listed in `admin_users`.
- Added **Find & Link Existing User** to avoid manually copying Auth user IDs.
- Added borrower-side **Change password** flow.
- Moved borrower **Change password** into the top header as a small button, not a main dashboard card.
- Fixed reset flow for MFA/AAL2 password-reset requirement.

## Forgot password improvements

- Borrower **Forgot Password** now opens a separate reset form with its own email field.
- Admin **Reset admin password** now opens a separate reset form with its own email field.
- Both flows now use clearer messaging:
  - enter email
  - send reset link
  - back to sign in
- This avoids the confusing old behavior where users had to know to type their email into the sign-in form before clicking reset.

## Alex Callejas loan import

- Imported Alex Callejas loan from emailed `alex.xlsx`.
- Borrower email: `alexcallegas123@gmail.com`.
- Verified loan ID: `8b840d85-afbe-4f4e-8216-adbf15732b2b`.
- Created combined loan totals:
  - Principal / total borrowed: `$63,000`
  - Payments: `$28,301`
  - Balance: `$34,699`
- Added real Supabase table for advances: `loan_advances`.
- Schema file: `supabase/loan_advances.sql`.
- Inserted Alex’s 3 advances:
  - `$8,000`
  - `$45,000`
  - `$10,000`

## Borrower portal loan activity

- Borrower portal now shows both:
  - borrowed/disbursement rows
  - payment rows
- Activity is shown newest first.
- Running balance shows the balance after each activity.
- Borrowed rows use positive amounts.
- Payment rows use negative amounts.
- Added badges and colored amount styling for clearer readability.

## Visual polish and branding

- Unified Home, Admin, and Borrower page styling.
- Shared Mango Loan color direction:
  - mango orange/yellow
  - deep green
  - warm cream background
  - dark brown/charcoal text
- Home page now has a product-style hero section.
- Admin and Borrower pages now share the same warm Mango Loan visual language.
- Added cute smiling mango SVG mascot: `assets/mango-cute-mark.svg`.
- Used the cute mango mark across Home, Admin, and Borrower headers.
- Added generated logo option sheets:
  - `assets/logo-options/mango-loan-logo-options-1.png`
  - `assets/logo-options/mango-loan-logo-options-2.png`
  - `assets/logo-options/mango-loan-logo-options-3.png`
  - `assets/logo-options/mango-loan-logo-options-4.png`
  - `assets/logo-options/mango-loan-cute-logo-options-1.png`
  - `assets/logo-options/mango-loan-cute-logo-options-2.png`
  - `assets/logo-options/mango-loan-cute-logo-options-3.png`
  - `assets/logo-options/mango-loan-cute-logo-options-4.png`
- Generated logo text was checked; options spell “Mango Loan” correctly.

## Key commits

- `280b5ea` — Add loan advance activity rows
- `cbc9b4f` — Polish borrower portal UI
- `a50d0a7` — Improve borrower forgot password flow
- `3cd83fe` — Improve admin forgot password flow
- `ceaa72f` — Unify Mango Loan styling and add logo options
- `b007768` — Make Mango Loan branding cuter

## Important design decisions

- Supabase Auth admin actions should stay in Edge Functions so the service role key is never exposed in browser code.
- Borrower/admin password tools must stay separated to avoid accidentally changing an admin password from borrower-facing tools.
- Loan advances should live in `loan_advances`, not in notes parsing.
- Borrower portal should stay simple and clean: balance, paid, borrowed, due date, and activity.
- Password reset should follow normal website expectations: open a reset page/form, ask for email, then send link.
