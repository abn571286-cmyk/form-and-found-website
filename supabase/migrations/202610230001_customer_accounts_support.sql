create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  name text not null check (length(trim(name)) between 1 and 100),
  email text not null check (length(email) between 3 and 254),
  subject text not null check (length(trim(subject)) between 1 and 160),
  message text not null check (length(trim(message)) between 1 and 5000),
  status text not null default 'new' check (status in ('new', 'read', 'closed')),
  notification_status text not null default 'not_configured'
    check (notification_status in ('not_configured', 'sent', 'failed')),
  created_at timestamptz not null default now()
);
create index contact_messages_created_idx on public.contact_messages (created_at desc);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;
create policy "Administrators can read contact messages"
  on public.contact_messages for select to authenticated
  using ((select public.is_store_admin()));
grant select on public.contact_messages to authenticated;

create table public.order_notification_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  notification_type text not null default 'order_confirmation'
    check (notification_type = 'order_confirmation'),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, notification_type)
);
create index order_notification_attempts_status_idx
  on public.order_notification_attempts (status, updated_at);
alter table public.order_notification_attempts enable row level security;
revoke all on public.order_notification_attempts from anon, authenticated;
create policy "Administrators can read order notification attempts"
  on public.order_notification_attempts for select to authenticated
  using ((select public.is_store_admin()));
grant select on public.order_notification_attempts to authenticated;
create trigger order_notification_attempts_touch_updated_at
  before update on public.order_notification_attempts
  for each row execute function public.touch_updated_at();

create or replace function public.set_default_delivery_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in is required' using errcode = '42501';
  end if;

  update public.delivery_addresses
  set address = jsonb_set(address, '{is_default}', 'false'::jsonb, true)
  where user_id = auth.uid();

  update public.delivery_addresses
  set address = jsonb_set(address, '{is_default}', 'true'::jsonb, true)
  where id = p_address_id and user_id = auth.uid();
  if not found then
    raise exception 'Delivery address was not found';
  end if;
end;
$$;
revoke all on function public.set_default_delivery_address(uuid) from public, anon;
grant execute on function public.set_default_delivery_address(uuid) to authenticated;

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
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to create an order' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  if p_customer_email is null
     or length(p_customer_email) > 254
     or p_customer_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or p_customer_phone is null
     or length(trim(p_customer_phone)) not between 7 and 24
     or trim(p_customer_phone) !~ '^[+()0-9 -]+$'
     or jsonb_typeof(p_shipping_address) <> 'object'
     or coalesce(jsonb_typeof(p_shipping_address->'full_name'), '') <> 'string'
     or coalesce(jsonb_typeof(p_shipping_address->'recipient_phone'), '') <> 'string'
     or coalesce(jsonb_typeof(p_shipping_address->'province'), '') <> 'string'
     or coalesce(jsonb_typeof(p_shipping_address->'district'), '') <> 'string'
     or coalesce(jsonb_typeof(p_shipping_address->'municipality'), '') <> 'string'
     or coalesce(jsonb_typeof(p_shipping_address->'ward'), '') <> 'string'
     or coalesce(jsonb_typeof(p_shipping_address->'street'), '') <> 'string'
     or (p_shipping_address ? 'postal_code'
         and coalesce(jsonb_typeof(p_shipping_address->'postal_code'), '') <> 'string')
     or (p_shipping_address ? 'delivery_instructions'
         and coalesce(jsonb_typeof(p_shipping_address->'delivery_instructions'), '') <> 'string')
     or length(trim(coalesce(p_shipping_address->>'full_name', ''))) not between 1 and 100
     or length(trim(coalesce(p_shipping_address->>'recipient_phone', ''))) not between 7 and 24
     or trim(coalesce(p_shipping_address->>'recipient_phone', '')) !~ '^[+()0-9 -]+$'
     or length(trim(coalesce(p_shipping_address->>'province', ''))) not between 1 and 100
     or length(trim(coalesce(p_shipping_address->>'district', ''))) not between 1 and 100
     or length(trim(coalesce(p_shipping_address->>'municipality', ''))) not between 1 and 120
     or length(trim(coalesce(p_shipping_address->>'ward', ''))) not between 1 and 20
     or length(trim(coalesce(p_shipping_address->>'street', ''))) not between 1 and 240
     or length(coalesce(p_shipping_address->>'postal_code', '')) > 20
     or length(coalesce(p_shipping_address->>'delivery_instructions', '')) > 500 then
    raise exception 'Valid customer and delivery details are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be a JSON array';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    raise exception 'Order must contain between 1 and 20 variant lines';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id into v_order_id
  from public.orders
  where idempotency_key = p_idempotency_key
    and customer_user_id = auth.uid();
  if v_order_id is not null then return v_order_id; end if;
  if exists (select 1 from public.orders where idempotency_key = p_idempotency_key) then
    raise exception 'This checkout key is already in use';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := nullif(v_item->>'quantity', '')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'Each quantity must be between 1 and 99';
    end if;

    select * into v_variant
    from public.product_variants
    where id = (v_item->>'variant_id')::uuid;
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
