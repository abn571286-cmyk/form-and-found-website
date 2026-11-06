create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  product_image_url text not null,
  product_slug text not null,
  product_status text not null,
  customer_name text,
  customer_email text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (customer_user_id, product_id)
);

create index chat_conversations_customer_latest_idx
  on public.chat_conversations (customer_user_id, last_message_at desc);
create index chat_conversations_latest_idx
  on public.chat_conversations (last_message_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'admin')),
  content text not null check (length(trim(content)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at, id);
create index chat_messages_unread_idx
  on public.chat_messages (conversation_id, sender_role)
  where read_at is null;

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

create policy "Customers and administrators read chat conversations"
  on public.chat_conversations for select to authenticated
  using (customer_user_id = (select auth.uid()) or (select public.is_store_admin()));

create policy "Conversation participants read chat messages"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1
      from public.chat_conversations c
      where c.id = chat_messages.conversation_id
        and (c.customer_user_id = (select auth.uid()) or (select public.is_store_admin()))
    )
  );

create policy "Authenticated participants send chat messages as themselves"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (sender_role = 'customer' and not (select public.is_store_admin()))
      or (sender_role = 'admin' and (select public.is_store_admin()))
    )
    and exists (
      select 1
      from public.chat_conversations c
      where c.id = chat_messages.conversation_id
        and (c.customer_user_id = (select auth.uid()) or (select public.is_store_admin()))
    )
  );

revoke all on public.chat_conversations, public.chat_messages from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.chat_conversations, public.chat_messages to authenticated;
grant insert (id, conversation_id, sender_id, sender_role, content)
  on public.chat_messages to authenticated;

create or replace function public.create_chat_conversation(p_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_conversation_id uuid;
  v_customer_name text;
  v_customer_email text;
begin
  if v_user_id is null then
    raise exception 'Sign in to start a conversation' using errcode = '42501';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and publication_status = 'published';
  if not found then
    raise exception 'This product is no longer available for chat';
  end if;

  select coalesce(
    nullif(trim(cp.full_name), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), '')
  ), u.email
  into v_customer_name, v_customer_email
  from auth.users u
  left join public.customer_profiles cp on cp.user_id = u.id
  where u.id = v_user_id;

  if v_customer_email is null then
    raise exception 'Unable to verify your account details';
  end if;

  insert into public.chat_conversations (
    customer_user_id, product_id, product_name, product_image_url, product_slug,
    product_status, customer_name, customer_email
  ) values (
    v_user_id, v_product.id, v_product.name, v_product.image_url, v_product.slug,
    v_product.status, v_customer_name, v_customer_email
  )
  on conflict (customer_user_id, product_id) do update
    set product_name = excluded.product_name,
        product_image_url = excluded.product_image_url,
        product_slug = excluded.product_slug,
        product_status = excluded.product_status,
        customer_name = excluded.customer_name,
        customer_email = excluded.customer_email,
        updated_at = now()
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

revoke all on function public.create_chat_conversation(uuid) from public, anon;
grant execute on function public.create_chat_conversation(uuid) to authenticated;

create or replace function public.mark_chat_messages_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_sender_role text;
begin
  if v_user_id is null then
    raise exception 'Sign in to access chat' using errcode = '42501';
  end if;

  if public.is_store_admin() then
    v_sender_role := 'customer';
  else
    if not exists (
      select 1 from public.chat_conversations
      where id = p_conversation_id and customer_user_id = v_user_id
    ) then
      raise exception 'Conversation not found' using errcode = '42501';
    end if;
    v_sender_role := 'admin';
  end if;

  update public.chat_messages
  set read_at = now()
  where conversation_id = p_conversation_id
    and sender_role = v_sender_role
    and read_at is null;
end;
$$;

revoke all on function public.mark_chat_messages_read(uuid) from public, anon;
grant execute on function public.mark_chat_messages_read(uuid) to authenticated;

create or replace function public.set_chat_conversation_status(
  p_conversation_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_store_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_status not in ('open', 'resolved') then
    raise exception 'Invalid conversation status';
  end if;

  update public.chat_conversations
  set status = p_status, updated_at = now()
  where id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found';
  end if;
end;
$$;

revoke all on function public.set_chat_conversation_status(uuid, text) from public, anon;
grant execute on function public.set_chat_conversation_status(uuid, text) to authenticated;

create or replace function public.update_chat_conversation_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
  set last_message_at = new.created_at,
      updated_at = new.created_at,
      status = case when new.sender_role = 'customer' then 'open' else status end
  where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.update_chat_conversation_activity() from public, anon, authenticated;

create trigger chat_messages_update_conversation_activity
  after insert on public.chat_messages
  for each row execute function public.update_chat_conversation_activity();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_conversations'
    ) then
      alter publication supabase_realtime add table public.chat_conversations;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
