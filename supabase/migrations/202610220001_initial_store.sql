create extension if not exists pgcrypto;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_store_admin() from public;
grant execute on function public.is_store_admin() to anon, authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 1 and 160),
  description text not null default '',
  category text not null check (length(trim(category)) between 1 and 80),
  collection text,
  price_npr integer not null check (price_npr between 1 and 1000000),
  compare_at_price_npr integer check (compare_at_price_npr is null or compare_at_price_npr > price_npr),
  image_url text not null,
  gallery jsonb not null default '[]'::jsonb check (jsonb_typeof(gallery) = 'array'),
  status text not null default 'Coming soon'
    check (status in ('In stock', 'Low stock', 'Sold out', 'Coming soon')),
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'archived')),
  sku text,
  materials text,
  care text,
  featured boolean not null default false,
  is_new_arrival boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_publication_updated_idx
  on public.products (publication_status, updated_at desc);
create index products_category_idx on public.products (category);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null check (length(trim(size)) between 1 and 32),
  color text not null check (length(trim(color)) between 1 and 64),
  sku text,
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size, color)
);
create index product_variants_product_idx on public.product_variants (product_id);

create view public.public_product_variants
with (security_barrier = true)
as
select v.id, v.product_id, v.size, v.color, (v.stock > 0) as available
from public.product_variants v
join public.products p on p.id = v.product_id
where p.publication_status = 'published';
revoke all on public.public_product_variants from public;
grant select on public.public_product_variants to anon, authenticated;

create table public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.delivery_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  address jsonb not null check (jsonb_typeof(address) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index delivery_addresses_user_idx on public.delivery_addresses (user_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  idempotency_key uuid not null unique,
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_email text not null,
  customer_phone text not null,
  shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
  subtotal_npr integer not null check (subtotal_npr >= 0),
  delivery_fee_npr integer not null check (delivery_fee_npr >= 0),
  total_npr integer not null check (total_npr = subtotal_npr + delivery_fee_npr),
  order_status text not null default 'pending'
    check (order_status in ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_status_created_idx on public.orders (order_status, created_at desc);
create index orders_customer_idx on public.orders (customer_user_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete restrict,
  product_name text not null,
  variant_label text not null,
  unit_price_npr integer not null check (unit_price_npr >= 0),
  quantity integer not null check (quantity > 0),
  line_total_npr integer not null check (line_total_npr = unit_price_npr * quantity),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null,
  provider_reference text,
  amount_npr integer not null check (amount_npr >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'failed', 'refunded')),
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);
create index payment_transactions_order_idx on public.payment_transactions (order_id);

create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_entity_idx on public.admin_audit_events (entity_type, entity_id, created_at desc);

create table public.store_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_touch_updated_at before update on public.products
for each row execute function public.touch_updated_at();
create trigger variants_touch_updated_at before update on public.product_variants
for each row execute function public.touch_updated_at();
create trigger profiles_touch_updated_at before update on public.customer_profiles
for each row execute function public.touch_updated_at();
create trigger addresses_touch_updated_at before update on public.delivery_addresses
for each row execute function public.touch_updated_at();
create trigger orders_touch_updated_at before update on public.orders
for each row execute function public.touch_updated_at();

alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.delivery_addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.admin_audit_events enable row level security;
alter table public.store_settings enable row level security;

create policy "Administrators can read their own role"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Public can read published products"
  on public.products for select to anon, authenticated
  using (publication_status = 'published' or (select public.is_store_admin()));
create policy "Administrators can insert products"
  on public.products for insert to authenticated
  with check ((select public.is_store_admin()));
create policy "Administrators can update products"
  on public.products for update to authenticated
  using ((select public.is_store_admin()))
  with check ((select public.is_store_admin()));
create policy "Administrators can delete products"
  on public.products for delete to authenticated
  using ((select public.is_store_admin()));

create policy "Administrators can read variants"
  on public.product_variants for select to authenticated
  using ((select public.is_store_admin()));
create policy "Administrators can manage variants"
  on public.product_variants for all to authenticated
  using ((select public.is_store_admin()))
  with check ((select public.is_store_admin()));

create policy "Users can read own profile"
  on public.customer_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can insert own profile"
  on public.customer_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update own profile"
  on public.customer_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users can manage own delivery addresses"
  on public.delivery_addresses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Administrators can read orders"
  on public.orders for select to authenticated
  using ((select public.is_store_admin()) or customer_user_id = (select auth.uid()));
create policy "Administrators can read order items"
  on public.order_items for select to authenticated
  using (
    (select public.is_store_admin())
    or exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_user_id = (select auth.uid())
    )
  );
create policy "Administrators can read payment references"
  on public.payment_transactions for select to authenticated using ((select public.is_store_admin()));
create policy "Administrators can read audit events"
  on public.admin_audit_events for select to authenticated using ((select public.is_store_admin()));
create policy "Administrators can write store settings"
  on public.store_settings for all to authenticated
  using ((select public.is_store_admin())) with check ((select public.is_store_admin()));
create policy "Public can read delivery fee setting"
  on public.store_settings for select to anon, authenticated
  using (key = 'delivery_fee_npr');

grant select on public.products to anon, authenticated;
grant select on public.product_variants to authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update on public.customer_profiles to authenticated;
grant select, insert, update, delete on public.delivery_addresses to authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items, public.payment_transactions, public.admin_audit_events to authenticated;
grant select on public.store_settings to anon, authenticated;
grant insert, update, delete on public.store_settings to authenticated;

create or replace function public.admin_save_product(p_product jsonb, p_variants jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_variant jsonb;
  v_slug text;
  v_name text;
  v_price integer;
  v_compare integer;
  v_publication text;
  v_status text;
  v_total_stock bigint := 0;
begin
  if not public.is_store_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) = 0 then
    raise exception 'At least one size and colour variant is required';
  end if;

  v_slug := lower(trim(p_product->>'slug'));
  v_name := trim(p_product->>'name');
  v_price := (p_product->>'price_npr')::integer;
  v_compare := nullif(p_product->>'compare_at_price_npr', '')::integer;
  v_publication := coalesce(p_product->>'publication_status', 'draft');
  v_status := coalesce(p_product->>'status', 'Coming soon');
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or v_name = '' or v_price <= 0 then
    raise exception 'Product name, URL slug, and a positive whole-number NPR price are required';
  end if;
  if v_compare is not null and v_compare <= v_price then
    raise exception 'Compare-at price must exceed selling price';
  end if;
  if v_publication not in ('draft', 'published', 'archived') then
    raise exception 'Invalid publication status';
  end if;

  if nullif(p_product->>'id', '') is null then
    insert into public.products (
      slug, name, description, category, collection, price_npr, compare_at_price_npr,
      image_url, gallery, status, publication_status, sku, materials, care, featured, is_new_arrival
    ) values (
      v_slug, v_name, coalesce(p_product->>'description', ''), trim(p_product->>'category'),
      nullif(trim(p_product->>'collection'), ''), v_price, v_compare,
      trim(p_product->>'image_url'), coalesce(p_product->'gallery', '[]'::jsonb),
      v_status, v_publication,
      nullif(trim(p_product->>'sku'), ''), nullif(trim(p_product->>'materials'), ''),
      nullif(trim(p_product->>'care'), ''), coalesce((p_product->>'featured')::boolean, false),
      coalesce((p_product->>'is_new_arrival')::boolean, false)
    ) returning id into v_product_id;
  else
    v_product_id := (p_product->>'id')::uuid;
    update public.products set
      slug = v_slug,
      name = v_name,
      description = coalesce(p_product->>'description', ''),
      category = trim(p_product->>'category'),
      collection = nullif(trim(p_product->>'collection'), ''),
      price_npr = v_price,
      compare_at_price_npr = v_compare,
      image_url = trim(p_product->>'image_url'),
      gallery = coalesce(p_product->'gallery', '[]'::jsonb),
      status = v_status,
      publication_status = v_publication,
      sku = nullif(trim(p_product->>'sku'), ''),
      materials = nullif(trim(p_product->>'materials'), ''),
      care = nullif(trim(p_product->>'care'), ''),
      featured = coalesce((p_product->>'featured')::boolean, false),
      is_new_arrival = coalesce((p_product->>'is_new_arrival')::boolean, false)
    where id = v_product_id;
    if not found then raise exception 'Product was not found'; end if;
  end if;

  delete from public.product_variants
  where product_id = v_product_id
    and not exists (
      select 1 from jsonb_array_elements(p_variants) incoming
      where trim(incoming->>'size') = public.product_variants.size
        and trim(incoming->>'color') = public.product_variants.color
    );
  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    if trim(v_variant->>'size') = '' or trim(v_variant->>'color') = ''
       or (v_variant->>'stock')::integer < 0 then
      raise exception 'Every variant requires a size, colour, and non-negative stock quantity';
    end if;
    v_total_stock := v_total_stock + (v_variant->>'stock')::integer;
    insert into public.product_variants (product_id, size, color, sku, stock)
    values (
      v_product_id,
      trim(v_variant->>'size'),
      trim(v_variant->>'color'),
      nullif(trim(v_variant->>'sku'), ''),
      (v_variant->>'stock')::integer
    )
    on conflict (product_id, size, color) do update set
      sku = excluded.sku,
      stock = excluded.stock;
  end loop;
  if exists (
    select 1
    from jsonb_array_elements(p_variants) incoming
    group by trim(incoming->>'size'), trim(incoming->>'color')
    having count(*) > 1
  ) then
    raise exception 'Each size and colour variant may only be listed once';
  end if;
  if v_status in ('In stock', 'Low stock') and v_total_stock < 1 then
    raise exception 'In-stock products require at least one recorded unit';
  end if;
  if v_status in ('Sold out', 'Coming soon') and v_total_stock <> 0 then
    raise exception 'Sold-out and coming-soon products cannot have purchasable stock';
  end if;

  insert into public.admin_audit_events (actor_user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    case when p_product ? 'id' then 'product_updated' else 'product_created' end,
    'product',
    v_product_id,
    jsonb_build_object('slug', v_slug, 'publication_status', v_publication)
  );
  return v_product_id;
end;
$$;

revoke all on function public.admin_save_product(jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_product(jsonb, jsonb) to authenticated;

create or replace function public.create_authenticated_order(
  p_idempotency_key uuid,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_variant public.product_variants%rowtype;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal integer := 0;
  v_delivery integer;
  v_item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to create an order until a protected guest-order endpoint is configured' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  if p_customer_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or length(trim(p_customer_phone)) < 7
     or jsonb_typeof(p_shipping_address) <> 'object' then
    raise exception 'Valid customer and delivery details are required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 20 then
    raise exception 'Order must contain between 1 and 20 variant lines';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
  if v_order_id is not null then return v_order_id; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_count := v_item_count + 1;
    v_quantity := nullif(v_item->>'quantity', '')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then raise exception 'Each quantity must be between 1 and 99'; end if;

    select * into v_variant
    from public.product_variants
    where id = (v_item->>'variant_id')::uuid
    ;
    if not found then raise exception 'One or more selected variants are unavailable'; end if;

    select * into v_product
    from public.products
    where id = v_variant.product_id and publication_status = 'published'
      and status in ('In stock', 'Low stock')
    for share;
    if not found then raise exception 'One or more selected products are unavailable'; end if;

    select * into v_variant
    from public.product_variants
    where id = (v_item->>'variant_id')::uuid
    for update;
    if not found or v_variant.stock < v_quantity then
      raise exception 'One or more selected variants are unavailable';
    end if;

    update public.product_variants set stock = stock - v_quantity where id = v_variant.id;
    v_subtotal := v_subtotal + (v_product.price_npr * v_quantity);
  end loop;

  select (value #>> '{}')::integer into v_delivery
  from public.store_settings where key = 'delivery_fee_npr';
  if not found then raise exception 'Delivery fee has not been configured'; end if;
  if v_delivery < 0 or v_delivery > 100000 then raise exception 'Delivery charge configuration is invalid'; end if;

  v_order_number := 'FF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.orders (
    order_number, idempotency_key, customer_user_id, customer_email, customer_phone,
    shipping_address, subtotal_npr, delivery_fee_npr, total_npr
  ) values (
    v_order_number, p_idempotency_key, auth.uid(), lower(trim(p_customer_email)),
    trim(p_customer_phone), p_shipping_address, v_subtotal, v_delivery, v_subtotal + v_delivery
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_variant from public.product_variants where id = (v_item->>'variant_id')::uuid;
    select * into v_product from public.products where id = v_variant.product_id;
    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_label,
      unit_price_npr, quantity, line_total_npr
    ) values (
      v_order_id, v_product.id, v_variant.id, v_product.name,
      v_variant.size || ' / ' || v_variant.color, v_product.price_npr,
      v_quantity, v_product.price_npr * v_quantity
    );
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.create_authenticated_order(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_authenticated_order(uuid, text, text, jsonb, jsonb) to authenticated;

create or replace function public.admin_set_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
begin
  if not public.is_store_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_status not in ('pending', 'processing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'Invalid order status';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.order_status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'A cancelled order cannot be reopened';
  end if;
  if p_status = 'cancelled' and v_order.order_status <> 'cancelled' then
    if v_order.order_status in ('shipped', 'delivered') then
      raise exception 'A shipped or delivered order cannot be cancelled';
    end if;
    if v_order.payment_status = 'paid' then
      raise exception 'A paid order requires a verified refund before cancellation';
    end if;
    for v_item in select * from public.order_items where order_id = p_order_id
    loop
      if v_item.variant_id is not null then
        update public.product_variants set stock = stock + v_item.quantity where id = v_item.variant_id;
      end if;
    end loop;
  end if;
  if v_order.order_status <> p_status then
    if p_status = 'processing' and v_order.order_status <> 'pending'
       or p_status = 'shipped' and v_order.order_status <> 'processing'
       or p_status = 'delivered' and v_order.order_status <> 'shipped' then
      raise exception 'Order status transition is not allowed';
    end if;
  end if;
  update public.orders set order_status = p_status where id = p_order_id;
  insert into public.admin_audit_events (actor_user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'order_status_changed', 'order', p_order_id, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function public.admin_set_order_status(uuid, text) from public, anon;
grant execute on function public.admin_set_order_status(uuid, text) to authenticated;

create or replace function public.record_verified_payment(
  p_order_id uuid,
  p_provider text,
  p_provider_reference text,
  p_verified_amount_npr integer,
  p_provider_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified payment callbacks require trusted server credentials' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.total_npr <> p_verified_amount_npr then raise exception 'Verified payment amount does not match order total'; end if;
  if v_order.payment_status = 'paid' then return; end if;

  insert into public.payment_transactions (
    order_id, provider, provider_reference, amount_npr, status, provider_payload
  ) values (
    p_order_id, p_provider, p_provider_reference, p_verified_amount_npr, 'verified', p_provider_payload
  );
  update public.orders set payment_status = 'paid' where id = p_order_id;
end;
$$;
revoke all on function public.record_verified_payment(uuid, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_payment(uuid, text, text, integer, jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Public reads published product images"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'product-images'
    and (select public.is_store_admin() or exists (
      select 1 from public.products p
      where p.publication_status = 'published'
        and (
          p.image_url like '%' || storage.objects.name
          or exists (
            select 1
            from jsonb_array_elements_text(p.gallery) as gallery_images(image_url)
            where gallery_images.image_url like '%' || storage.objects.name
          )
        )
    ))
  );
create policy "Administrators upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_store_admin()));
create policy "Administrators update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_store_admin()))
  with check (bucket_id = 'product-images' and (select public.is_store_admin()));
create policy "Administrators delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_store_admin()));
