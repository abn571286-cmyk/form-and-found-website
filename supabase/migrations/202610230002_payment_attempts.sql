create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null check (provider in ('esewa', 'khalti')),
  provider_reference text,
  provider_transaction_id text,
  payment_url text,
  amount_npr integer not null check (amount_npr > 0),
  verified_amount_npr integer check (verified_amount_npr >= 0),
  status text not null default 'initiating'
    check (status in ('initiating', 'pending', 'verified', 'failed', 'cancelled', 'expired', 'verification_unavailable', 'review')),
  verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_attempts_order_idx
  on public.payment_attempts (order_id, created_at desc);
create index payment_attempts_customer_idx
  on public.payment_attempts (customer_user_id, created_at desc);
create unique index payment_attempts_provider_reference_idx
  on public.payment_attempts (provider, provider_reference)
  where provider_reference is not null;
-- Uncertain attempts block a second charge until they can be reconciled.
create unique index payment_attempts_active_order_provider_idx
  on public.payment_attempts (order_id, provider)
  where status in ('initiating', 'pending', 'verification_unavailable', 'review');

alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from anon, authenticated;
grant all on public.payment_attempts to service_role;
create policy "Customers can read their own payment attempts"
  on public.payment_attempts for select to authenticated
  using (customer_user_id = (select auth.uid()) or (select public.is_store_admin()));
grant select on public.payment_attempts to authenticated;
create trigger payment_attempts_touch_updated_at
  before update on public.payment_attempts
  for each row execute function public.touch_updated_at();

create or replace function public.create_payment_attempt(
  p_order_id uuid,
  p_provider text
)
returns table (
  attempt_id uuid,
  order_number text,
  amount_npr integer,
  customer_email text,
  customer_phone text,
  attempt_status text,
  provider_reference text,
  payment_url text,
  new_attempt boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to initiate payment' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('esewa', 'khalti') then
    raise exception 'Unsupported payment provider';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and customer_user_id = auth.uid()
  for update;
  if not found then raise exception 'Order was not found' using errcode = 'P0002'; end if;
  if v_order.order_status <> 'pending' then
    raise exception 'Payment is only available for pending orders';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'This order is not awaiting payment';
  end if;
  if v_order.total_npr <= 0 then raise exception 'Order total must be positive'; end if;

  select * into v_attempt
  from public.payment_attempts
  where order_id = v_order.id
    and status in ('initiating', 'pending', 'verification_unavailable', 'review')
  order by created_at desc
  limit 1;

  if found then
    if v_attempt.provider <> p_provider then
      raise exception 'A different payment gateway already has an active attempt for this order';
    end if;
    return query select v_attempt.id, v_order.order_number, v_attempt.amount_npr,
      v_order.customer_email, v_order.customer_phone, v_attempt.status,
      v_attempt.provider_reference, v_attempt.payment_url, false;
    return;
  end if;

  update public.orders set payment_method = p_provider where id = v_order.id;
  insert into public.payment_attempts (order_id, customer_user_id, provider, amount_npr)
  values (v_order.id, auth.uid(), p_provider, v_order.total_npr)
  returning * into v_attempt;

  return query select v_attempt.id, v_order.order_number, v_attempt.amount_npr,
    v_order.customer_email, v_order.customer_phone, v_attempt.status,
    v_attempt.provider_reference, v_attempt.payment_url, true;
end;
$$;
revoke all on function public.create_payment_attempt(uuid, text) from public, anon;
grant execute on function public.create_payment_attempt(uuid, text) to authenticated;

create or replace function public.record_verified_payment_attempt(
  p_attempt_id uuid,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_verified_amount_npr integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified payment callbacks require trusted server credentials' using errcode = '42501';
  end if;
  if p_provider_reference is null or length(trim(p_provider_reference)) = 0 then
    raise exception 'A verified provider reference is required';
  end if;

  select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
  for update;
  if not found then raise exception 'Payment attempt was not found'; end if;
  if v_attempt.status = 'verified' then return; end if;

  select * into v_order
  from public.orders
  where id = v_attempt.order_id
  for update;
  if not found then raise exception 'Payment order was not found'; end if;
  if v_attempt.amount_npr <> p_verified_amount_npr
     or v_order.total_npr <> p_verified_amount_npr
     or v_order.payment_method <> v_attempt.provider then
    raise exception 'Verified payment does not match the stored order';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'A different payment has already been recorded for this order';
  end if;

  perform public.record_verified_payment(
    v_order.id,
    v_attempt.provider,
    p_provider_reference,
    p_verified_amount_npr,
    jsonb_build_object(
      'verification_source', 'server_side_provider_lookup',
      'provider_transaction_id', p_provider_transaction_id,
      'payment_attempt_id', v_attempt.id
    )
  );
  update public.payment_attempts
  set status = 'verified',
      provider_transaction_id = p_provider_transaction_id,
      verified_amount_npr = p_verified_amount_npr,
      verified_at = now(),
      last_error = null
  where id = v_attempt.id;
end;
$$;
revoke all on function public.record_verified_payment_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_verified_payment_attempt(uuid, text, text, integer) to service_role;

alter table public.order_notification_attempts
  drop constraint order_notification_attempts_notification_type_check;
alter table public.order_notification_attempts
  add constraint order_notification_attempts_notification_type_check
  check (notification_type in ('order_confirmation', 'payment_confirmation'));
