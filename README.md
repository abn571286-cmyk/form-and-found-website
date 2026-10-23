# FORM & FOUND

Premium streetwear storefront for FORM & FOUND. The current app keeps a local demo catalogue when no backend is configured. With Supabase configured, storefront products come from the published database catalogue, and `/admin` provides Supabase Auth-protected product, inventory, and order-management screens.

Contact: [9840180193](tel:+9779840180193) · [abhiyan080@gmail.com](mailto:abhiyan080@gmail.com)

## 1. Run locally

Requirements: Node.js 20 or later and npm.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. Check the app with:

```powershell
npm run build
npm run lint
```

Without Supabase settings, the shop runs from the sample catalogue in `src/data/products.ts`, and cart and wishlist are demo data stored in this browser. Checkout is a form preview only. It does not submit an order or collect payment.
If a product photo URL is unavailable, product cards, product details, and the bag use `public/product-placeholder.svg`. Replace a demo image by updating that product's `image` URL in `src/data/products.ts`; with Supabase configured, upload the image from `/admin` instead. The hero uses its own editorial photo URL.

The `/contact` page validates the demo contact form but does not send or store messages. Use the configured contact email shown on that page. `/new-arrivals` is a separate storefront page showing only products explicitly flagged `isNewArrival`; `/shop` continues to show the complete published catalogue. Product records loaded from Supabase retain their real `created_at` timestamps for New Arrivals ordering. Demo products without a creation date are ordered by the existing source-catalog order; no dates are inferred or generated. In the owner dashboard, set **Mark as new arrival** on the product editor to persist the flag to Supabase. New products default to not-new.

## 2. Connect a Supabase project

1. Create a Supabase project and keep its database password and service-role key private.
2. Copy `.env.example` to `.env.local`.
3. In Supabase Project Settings → API, copy the Project URL and public anon/publishable key into `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   ```

4. Restart Vite after changing environment variables.
5. In the Supabase SQL Editor, run the migration file `supabase/migrations/202610220001_initial_store.sql`.
6. Create an administrator in Supabase Authentication → Users → Add user. Disable public signups in Auth settings.
7. In the Supabase SQL Editor, grant the admin role to that Auth user's UUID:

   ```sql
   insert into public.admin_users (user_id)
   values ('PASTE-THE-AUTH-USER-UUID-HERE');
   ```

   Only grant this role to a trusted owner. Removing the row revokes admin access.
8. In the SQL Editor, set the verified delivery charge before enabling any order flow:

   ```sql
   insert into public.store_settings (key, value)
   values ('delivery_fee_npr', '0'::jsonb)
   on conflict (key) do update
   set value = excluded.value, updated_at = now();
   ```

   Replace zero with the actual configured charge. The current demo checkout does not use this setting or submit orders.
9. Start/restart the app and open `/admin`. Sign in with the authorized Auth user. Add a draft product, upload the primary image, enter variant rows and verified quantities, then publish. Only published products are visible to the public catalogue.

`.env.local` is ignored by Git. Never put a Supabase service-role key, payment secret, or webhook signing secret in `VITE_*` variables or any browser bundle. The anon/publishable key is intentionally public; RLS is the access boundary.

## 3. Owner product workflow

The dashboard can add, edit, duplicate, publish, unpublish, and archive products; upload JPG, PNG, WebP, or AVIF product images (8 MB maximum); preview images; manage gallery URLs; and enter size, colour, variant SKU, and stock. It validates generated URL slugs, duplicate slugs, positive integer NPR pricing, optional compare-at pricing, and variant quantities. Database constraints and `admin_save_product` repeat important checks server-side. Published items immediately load into the shop, search, product pages, wishlist, and bag from the same public catalogue source.

Variant inventory uses one row per real size/colour, for example:

```text
S | Black | 4 | FNF-TEE-S-BLK
M | Black | 0 | FNF-TEE-M-BLK
S | White | 2 | FNF-TEE-S-WHT
```

Enter real stock only. A product marked In stock or Low stock must have at least one recorded unit; Sold out and Coming soon require zero. Updating a product preserves variant IDs for unchanged size/colour combinations so order references remain stable. Removed variants with historical order references are protected by database constraints.

The original demo products stay in `src/data/products.ts` and are used only when Supabase environment values are absent. Do not add production products there after connecting Supabase. The shared storefront context switches all shop surfaces to the published database catalogue.

## 4. Security and database foundation

The migration creates products, variants/inventory, administrator roles, private customer profiles and addresses, orders, immutable order-item price snapshots, payment references, store settings, and administrator audit events.

- Public reads are limited to published products and their variants.
- Admin identity is checked by the database through `admin_users` and `is_store_admin()`. Hiding the dashboard route or link is not the security boundary.
- Product changes use a database function with server-side validation and audit events. Image writes require an authorized admin; public image reads are for storefront product imagery.
- The order function accepts only authenticated users, locks and validates variants, reads current server prices and configured delivery fees, decrements stock atomically, uses an idempotency key, and creates a pending-payment order. It does not trust browser totals or prices.
- Admin order status changes use a database function. Cancellation is restricted and restores reserved stock only for eligible unpaid orders; paid, shipped, and delivered orders cannot be cancelled through that path.
- Payment status is separate from order status. Only a trusted server callback may call `record_verified_payment`; that function requires the service-role JWT role and checks the provider-verified amount against the server order total.
- The dashboard cannot manually mark payment as paid, and no payment provider is configured.

The migration is supplied but has **not** been applied to a live project in this workspace. SQL policies and functions have not been exercised against your Supabase instance. Apply it to a disposable test project first, review it, and test RLS using anon, regular authenticated, and admin users before production.

## 5. Order, guest checkout, and payment status

The customer-facing `/checkout` remains clearly labelled demo mode. `src/lib/orders.ts` contains a typed authenticated order call that sends variant IDs and quantities only; the SQL calculates prices, delivery, and totals. There is no customer signup/login UX, so this order call is not currently reachable from checkout. Guest orders require a trusted Edge Function or backend endpoint with request validation, abuse/rate limiting, spam protection, and server-only database credentials; do not expose an anonymous stock-reserving RPC.

No eSewa, Khalti, Fonepay, bank transfer, or cash-on-delivery integration is active. For a real payment provider, implement its checkout creation and signed webhook verification in a server/Edge Function, validate amount and currency against the order, make callbacks idempotent, and then call the verified-payment database function. Never treat a browser redirect as payment proof or collect card details directly.

## 6. Before production launch

- Apply and test the SQL migration and all RLS policies in a separate Supabase project.
- Create the owner Auth account; disable public admin signups; add only trusted user UUIDs to `admin_users`.
- Configure domain, Supabase Auth URL allow-list, HTTPS hosting, environment values, and backups.
- Test product/image CRUD, public product visibility, admin-only writes, unauthorized access, inventory updates, order row security, and cancellation/restoration with multiple users.
- Build customer authentication or a protected guest-order Edge Function and connect a reviewed order flow. Keep the current demo checkout disabled for real orders until this is complete.
- Configure delivery fees, customer support, returns, privacy/terms, taxes, and order email handling.
- Integrate a chosen payment provider server-side; test signed callbacks, duplicate notifications, amount mismatches, refunds, and failure states.
- Add monitoring, database backups/retention, rate limits, fraud/abuse controls, and operational support procedures.
- Use real product photography you own or are licensed to use; verify image credits and optimize/resize images before upload.
- Run `npm run build` and `npm run lint` against the release commit.

## Troubleshooting

- **Admin shows backend setup:** check `.env.local` values and restart Vite.
- **Sign-in works but dashboard denies access:** confirm the signed-in Auth user's UUID exists in `public.admin_users`.
- **Products fail to load:** inspect browser network errors and Supabase API logs; verify the migration ran and public product rows are published. The storefront offers a retry and intentionally does not hide configured-backend failures behind demo data.
- **Image upload is denied:** verify admin role, storage bucket/policies from the migration, file type, and the 8 MB limit.
- **Publish/save fails:** read the dashboard error for duplicate slug, invalid sale price, variant stock, RLS, or migration mismatch.
- **Types drift after changing schema:** regenerate `src/lib/database.types.ts` from your Supabase project using the Supabase CLI and review the generated diff before use. Current types are hand-maintained for the included migration.
- **Orders remain unavailable:** this is expected until customer authentication or a protected guest-order endpoint and verified delivery configuration are implemented. No payment integrations are active.
