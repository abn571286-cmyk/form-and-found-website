begin;

insert into public.store_settings (key, value)
values
  ('delivery_fee_npr', '120'::jsonb),
  ('delivery_coverage_districts', '["Kathmandu","Lalitpur","Bhaktapur"]'::jsonb),
  ('delivery_coverage_postal_codes', '{"Kathmandu":[],"Lalitpur":[],"Bhaktapur":[]}'::jsonb)
on conflict (key) do update
set value = excluded.value, updated_at = now();

create policy "Public can read delivery coverage districts"
  on public.store_settings for select to anon, authenticated
  using (key = 'delivery_coverage_districts');
create policy "Public can read delivery postal code coverage"
  on public.store_settings for select to anon, authenticated
  using (key = 'delivery_coverage_postal_codes');

create or replace function public.is_supported_delivery_address(p_address jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(regexp_replace(trim(p_address->>'province'), '[[:space:]]+province$', '', 'i')) = 'bagmati'
    and exists (
      select 1
      from public.store_settings settings
      where settings.key = 'delivery_coverage_districts'
        and case
          when jsonb_typeof(settings.value) = 'array' then exists (
            select 1
            from jsonb_array_elements_text(settings.value) supported(district)
            where lower(regexp_replace(trim(supported.district), '[[:space:]]+district$', '', 'i'))
              = lower(regexp_replace(trim(p_address->>'district'), '[[:space:]]+district$', '', 'i'))
          )
          else false
        end
    )
    and (
      nullif(trim(p_address->>'postal_code'), '') is null
      or exists (
        select 1
        from public.store_settings postal_settings
        where postal_settings.key = 'delivery_coverage_postal_codes'
          and case
            when jsonb_typeof(postal_settings.value) = 'object' then exists (
              select 1
              from jsonb_each(postal_settings.value) postal(district, codes)
              where lower(regexp_replace(trim(postal.district), '[[:space:]]+district$', '', 'i'))
                = lower(regexp_replace(trim(p_address->>'district'), '[[:space:]]+district$', '', 'i'))
                and case
                  when jsonb_typeof(postal.codes) = 'array' then exists (
                    select 1
                    from jsonb_array_elements_text(postal.codes) supported(code)
                    where trim(supported.code) = trim(p_address->>'postal_code')
                  )
                  else false
                end
            )
            else false
          end
      )
    ),
    false
  );
$$;
revoke all on function public.is_supported_delivery_address(jsonb) from public, anon, authenticated;

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
  v_delivery integer := 120;
  v_configured_fee jsonb;
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
  if not public.is_supported_delivery_address(p_shipping_address) then
    raise exception 'Delivery outside Kathmandu Valley is coming soon.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be a JSON array';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    raise exception 'Order must contain between 1 and 20 variant lines';
  end if;

  select value into v_configured_fee
  from public.store_settings
  where key = 'delivery_fee_npr';
  if not found or v_configured_fee <> to_jsonb(v_delivery) then
    raise exception 'Delivery charge configuration must be NPR 120.';
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

commit;
