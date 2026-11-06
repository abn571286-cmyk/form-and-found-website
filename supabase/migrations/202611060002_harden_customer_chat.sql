do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_conversations'
      and column_name = 'customer_user_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_conversations'
      and column_name = 'customer_id'
  ) then
    alter table public.chat_conversations rename column customer_user_id to customer_id;
  end if;
end;
$$;

create or replace function public.validate_chat_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
begin
  if v_user_id is null then
    raise exception 'Sign in to send a message' using errcode = '42501';
  end if;

  v_is_admin := public.is_store_admin();
  if not v_is_admin and not exists (
    select 1
    from public.chat_conversations c
    where c.id = new.conversation_id
      and c.customer_id = v_user_id
  ) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;

  if length(trim(new.content)) not between 1 and 4000 then
    raise exception 'Messages must contain between 1 and 4000 characters';
  end if;

  new.sender_id := v_user_id;
  new.sender_role := case when v_is_admin then 'admin' else 'customer' end;
  return new;
end;
$$;

revoke all on function public.validate_chat_message_sender() from public, anon, authenticated;

drop trigger if exists chat_messages_validate_sender on public.chat_messages;
create trigger chat_messages_validate_sender
  before insert on public.chat_messages
  for each row execute function public.validate_chat_message_sender();

create or replace function public.open_chat_conversation(p_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_product_name text;
  v_product_image_url text;
  v_product_slug text;
  v_product_status text;
  v_customer_name text;
  v_customer_email text;
begin
  if v_user_id is null then
    raise exception 'Sign in to start a conversation' using errcode = '42501';
  end if;
  if public.is_store_admin() then
    raise exception 'Administrators cannot start customer conversations' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.publication_status = 'published'
  ) then
    raise exception 'This product is not available for chat';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_product_id::text, 0));

  select c.id into v_conversation_id
  from public.chat_conversations c
  where c.customer_id = v_user_id
    and c.product_id = p_product_id
  order by c.created_at desc
  limit 1;

  if v_conversation_id is null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chat_conversations'
        and column_name = 'product_name'
    ) then
      select p.name, p.image_url, p.slug, p.status
      into v_product_name, v_product_image_url, v_product_slug, v_product_status
      from public.products p
      where p.id = p_product_id;

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
        customer_id, product_id, product_name, product_image_url, product_slug,
        product_status, customer_name, customer_email
      ) values (
        v_user_id, p_product_id, v_product_name, v_product_image_url, v_product_slug,
        v_product_status, v_customer_name, v_customer_email
      )
      returning id into v_conversation_id;
    else
      insert into public.chat_conversations (customer_id, product_id)
      values (v_user_id, p_product_id)
      returning id into v_conversation_id;
    end if;
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.open_chat_conversation(uuid) from public, anon;
grant execute on function public.open_chat_conversation(uuid) to authenticated;

create or replace function public.create_chat_conversation(p_product_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.open_chat_conversation(p_product_id);
$$;

revoke all on function public.create_chat_conversation(uuid) from public, anon;
grant execute on function public.create_chat_conversation(uuid) to authenticated;

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
      select 1
      from public.chat_conversations c
      where c.id = p_conversation_id
        and c.customer_id = v_user_id
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

revoke all on public.chat_conversations from public, anon, authenticated;
grant select on public.chat_conversations to authenticated;

revoke all on public.chat_messages from public, anon, authenticated;
grant select on public.chat_messages to authenticated;
grant insert (id, conversation_id, content) on public.chat_messages to authenticated;

notify pgrst, 'reload schema';
