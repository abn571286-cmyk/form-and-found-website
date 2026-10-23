# FORM & FOUND

Premium streetwear storefront for FORM & FOUND. The application uses React, TypeScript, Vite, React Router, and Supabase. Its customer account, saved addresses, order history, authenticated checkout, contact submissions, and owner dashboard require the configured Supabase project.

Customer support: [abhiyan080@gmail.com](mailto:abhiyan080@gmail.com) · [pranax909@gmail.com](mailto:pranax909@gmail.com) · [9840180193](tel:+9779840180193) · [9745233604](tel:+9779745233604)

## Run and validate locally

Requirements: Node.js 20 or later and npm.

```powershell
npm install
npm run dev
npm run build
npm run lint
```

With no Supabase configuration, a small catalogue in `src/data/products.ts` is available only in Vite development mode and is identified as a non-live preview. Production builds do not fall back to this catalogue. Cart and wishlist selections are stored in the current browser.

## Supabase configuration

1. Create a Supabase project. Do not put the service-role key, payment credentials, or email-provider secrets in client-side `VITE_*` variables.
2. Copy `.env.example` to `.env.local` and set the project URL and public anon/publishable key:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   ```

   `VITE_MANUAL_PAYMENT_NUMBER` optionally changes the owner-provided contact number shown in checkout. It is public contact information only, not a merchant credential or proof that this number can receive eSewa, Khalti, or other website payments. Manual payment is not enabled by this setting.

3. Apply `supabase/migrations/202610220001_initial_store.sql`, `supabase/migrations/202610230001_customer_accounts_support.sql`, `supabase/migrations/202610230002_payment_attempts.sql`, then `supabase/migrations/202610230003_kathmandu_delivery_pricing.sql`, in that order. Use a disposable project first. These local SQL files do not prove that the migrations have been applied to any live database.
4. Configure Supabase Auth Site URL and redirect allow-list for the deployed site and local development. Enable customer signup if new customers should register, and configure email verification according to the store's policy. Admin access remains separately controlled by `admin_users` and `is_store_admin()`.
5. Create the owner Auth user and grant only that trusted user's UUID the admin role:

   ```sql
   insert into public.admin_users (user_id)
   values ('PASTE-THE-TRUSTED-AUTH-USER-UUID-HERE');
   ```

6. The Kathmandu delivery migration seeds the fixed `delivery_fee_npr` value of NPR 120, `delivery_coverage_districts` (`Kathmandu`, `Lalitpur`, `Bhaktapur`), and an initially empty `delivery_coverage_postal_codes` allow-list for each district. The order RPC rejects orders unless the configured fee is exactly NPR 120 and the authenticated address's province/district matches supported coverage. An entered postal code must match the server-managed allow-list; until verified codes are configured, leave this optional field blank. To expand service, update the coverage settings and matching UI/deployment configuration together; apply a reviewed migration rather than editing trusted order totals from the browser.

7. Add products and verified variant stock through `/admin`. Only published database products are shown in the production storefront.

The initial migration defines RLS and database functions for products, profiles, addresses, orders, payments, and admin operations. The customer-support migration adds private contact messages, order-notification attempt records, an owner-scoped default-address function, and server-side validation for the full delivery address. The payment migration adds owner-scoped, read-only payment attempt records and a server-only atomic verified-payment workflow. The Kathmandu delivery migration seeds the NPR 120 charge and district coverage, exposes coverage for checkout, and updates the authenticated order RPC to enforce Bagmati province, configured valley districts, the fixed fee, current product prices, stock, and totals. Orders begin with payment pending. The app never lets customers or admins mark payment as paid through ordinary frontend writes.

For Kathmandu Valley delivery, checkout requires Bagmati province and a supported district from `delivery_coverage_districts`. At launch the districts are Kathmandu, Lalitpur, and Bhaktapur. Postal-code coverage is an explicit allow-list in `delivery_coverage_postal_codes`. The migration leaves those allow-lists empty because no validated postal-code data was available; an entered code is rejected until the store configures verified coverage. The optional field may be left blank.

## Contact submissions and email

The `contact-message` Supabase Edge Function validates and stores messages in `contact_messages`; that table is readable only by authorized administrators. Without email-provider secrets, a successful response means the message was saved, not emailed. The page explains this distinction.

The `send-order-confirmation` Edge Function authenticates the customer, verifies order ownership, loads server-side order items and totals, and sends order or verified-payment confirmations through Resend. Its unique notification records prevent duplicate confirmations on refresh and record delivery attempts. Payment notifications are only accepted after the order has a matching verified transaction. A notification failure does not undo a successfully created order or verified payment.

Deploy the functions from the repository root after linking the correct Supabase project:

```powershell
supabase link --project-ref "YOUR_PROJECT_REF"
supabase functions deploy contact-message
supabase functions deploy send-order-confirmation
supabase functions deploy payment-options
supabase functions deploy payment-initiate
supabase functions deploy payment-verify
```

Verify a sending domain with Resend, then configure server-side function secrets. `CONTACT_FROM_EMAIL` and `ORDER_FROM_EMAIL` must be verified sender addresses. `CONTACT_TO_EMAIL` is optional and defaults to the primary support email above.

```powershell
supabase secrets set "RESEND_API_KEY=PASTE_SECRET" "CONTACT_FROM_EMAIL=PASTE_VERIFIED_SENDER" "ORDER_FROM_EMAIL=PASTE_VERIFIED_SENDER"
supabase secrets set "CONTACT_TO_EMAIL=PASTE_SUPPORT_INBOX"
```

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. If using a custom environment, configure those only as server-side function secrets. Never expose the service-role key or Resend key in browser code.

The public contact endpoint has server-side validation and a honeypot field. Before broad public launch, configure suitable platform-level rate limiting or a challenge service and test email deliverability. Message storage and message email notification are reported as separate outcomes.

## Checkout, orders, and payment

Checkout requires a signed-in customer, uses an idempotency key that survives retries in the current browser session, and sends variant IDs and quantities to `create_authenticated_order`. The database rechecks publication, stock, price, delivery configuration, and address fields before changing stock or creating an order. The cart is cleared only after the database confirms the order and its server-calculated details. When a gateway is configured, the customer reviews the database-calculated total before starting provider checkout.

Order history and payment attempts are selected with the authenticated customer's user ID and protected by RLS. Pending/processing/shipped records appear separately from delivered/cancelled history. The `/admin` dashboard continues to use `is_store_admin()`, `admin_save_product`, and `admin_set_order_status`; it displays the gateway and recorded verified payment reference/amount without allowing manual payment-status changes.

The payment functions implement eSewa ePay V2 and Khalti KPG-2 server-side initiation and provider status lookup. eSewa form signatures and returned callback signatures are checked with HMAC-SHA256 using the configured server secret; a valid signed callback is still followed by an authoritative provider status lookup. Khalti amounts are sent in paisa and confirmed through its lookup API. Browser return parameters are never treated alone as payment evidence. The backend checks provider, stored attempt, order association, reference, status, and exact amount, then atomically records verified payment through `record_verified_payment_attempt` and `record_verified_payment`. No order is automatically marked delivered.

Official specifications: [eSewa ePay](https://developer.esewa.com.np/pages/Epay) and [Khalti KPG-2](https://docs.khalti.com/khalti-epayment/). The eSewa documentation site serves its current ePay page as `Epay`; the prompt's `/pages/Epay-V2` path returned 404 during implementation.

Payment credentials are never Vite variables. Configure each provider independently in server-side Supabase function secrets. Example names (set actual credentials only in a trusted server-side secret manager):

```text
PUBLIC_SITE_URL=https://your-store-domain.example
ESEWA_MODE=sandbox
ESEWA_PRODUCT_CODE=YOUR_SANDBOX_PRODUCT_CODE
ESEWA_SECRET_KEY=YOUR_SANDBOX_SECRET
KHALTI_MODE=sandbox
KHALTI_SECRET_KEY=YOUR_SANDBOX_SECRET_KEY
```

The configured sandbox key must come from the provider's authorized merchant sandbox. Do not copy sample secrets from provider documentation into this repository. To configure production, use independently obtained production credentials and set `ESEWA_MODE=production` or `KHALTI_MODE=production`. Live checkout remains disabled until the corresponding provider has both `*_LIVE_ENABLED=true` and `*_SETTLEMENT_VERIFIED=true` set in server-side secrets. Set those flags only after the official merchant account and receiving/settlement configuration have been independently confirmed through the provider's authorized dashboard or support channel. Customer-support phone numbers are not payment destinations. Keep sandbox and production secret sets separate.

Example server-side deployment:

```powershell
supabase secrets set "PUBLIC_SITE_URL=PASTE_HTTPS_STORE_ORIGIN"
supabase secrets set "ESEWA_MODE=sandbox" "ESEWA_PRODUCT_CODE=PASTE_AUTHORIZED_SANDBOX_CODE" "ESEWA_SECRET_KEY=PASTE_AUTHORIZED_SANDBOX_SECRET"
supabase secrets set "KHALTI_MODE=sandbox" "KHALTI_SECRET_KEY=PASTE_AUTHORIZED_SANDBOX_KEY"
```

Do not set either production enablement flag before merchant/settlement verification. No credentials are included in this project, so the functions report payment gateways unavailable until configured. Production gateway availability, merchant settlement, sandbox payments, and email delivery have not been verified from this workspace. Payment status retries are initiated only by the authenticated order owner; server-held provider references are used for lookup.

## Production checks and limitations

- Review all four migrations and apply them to a staging project before production; the live database was not accessible from this workspace.
- Test RLS using separate anon, customer, and admin sessions, including attempts to read another customer's profile, addresses, orders, or order items.
- Test signup, verification redirects, sign-in, session persistence, email changes, address CRUD/default selection, order creation/retry, contact submission, and Admin product/order workflows against staging.
- Confirm the NPR 120 delivery setting and supported district list, publish products with real imagery and accurate stock, configure customer support policies, and verify the Supabase Auth redirect allow-list.
- Configure Resend sender-domain verification and test contact/order emails. A client response or database row alone is not proof that an email was delivered.
- Test eSewa and Khalti with authorized sandbox credentials, including complete, pending, cancelled, expired, mismatched-amount, repeated-callback, and lookup-unavailable cases. Verify that repeated checks cannot duplicate or downgrade a recorded payment.
- Confirm production merchant credentials and settlement destinations independently with each provider before setting its live enablement and settlement-verification flags.
- The project has no automated end-to-end test script. `npm run build` and `npm run lint` are the available repository checks.

If generated database types drift after applying migrations, regenerate them from the target project with the Supabase CLI and review the resulting diff before using it.
