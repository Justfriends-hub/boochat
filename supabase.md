# Supabase Backend — Stage 4

This file is the complete, production-ready SQL for the real backend behind the app. Paste each block into the Supabase SQL Editor in order. When you're done, wire the frontend up per the "Connecting the frontend" section at the bottom.

---

## 1. Extensions

```sql
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron";
create extension if not exists "pg_net";
```

## 2. Enums

```sql
create type public.app_role     as enum ('user', 'admin');
create type public.chat_type    as enum ('dm', 'group');
create type public.message_kind as enum ('text', 'image', 'voice');
create type public.post_kind    as enum ('text', 'image');
create type public.boost_kind   as enum ('likes', 'views');
```

## 3. Tables

```sql
-- Profiles: 1:1 with auth.users
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null,
  avatar_url   text,
  bio          text,
  online       boolean not null default false,
  banned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Roles live in their own table (never on profiles) to prevent privilege escalation.
create table public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role    public.app_role not null,
  unique (user_id, role)
);

create table public.chats (
  id                 uuid primary key default gen_random_uuid(),
  type               public.chat_type not null,
  name               text,
  avatar_url         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.chat_members (
  chat_id  uuid not null references public.chats(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid not null references public.chats(id) on delete cascade,
  sender_id     uuid not null references auth.users(id) on delete cascade,
  kind          public.message_kind not null default 'text',
  body          text not null default '',
  media_url     text,
  duration      int,
  reply_to      uuid references public.messages(id) on delete set null,
  forwarded_from uuid references auth.users(id) on delete set null,
  edited_at     timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table public.groups (
  id                uuid primary key default gen_random_uuid(),
  chat_id           uuid not null unique references public.chats(id) on delete cascade,
  name              text not null,
  avatar_url        text,
  owner_id          uuid not null references auth.users(id),
  only_admins_post  boolean not null default false,
  only_admins_add   boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  is_admin  boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_posts (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  kind       public.post_kind not null default 'text',
  body       text not null default '',
  image_url  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_post_reactions (
  post_id    uuid not null references public.group_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null default '❤️',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create table public.channels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  avatar_url  text,
  owner_id    uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  is_admin   boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.channel_posts (
  id             uuid primary key default gen_random_uuid(),
  channel_id     uuid not null references public.channels(id) on delete cascade,
  author_id      uuid not null references auth.users(id) on delete cascade,
  kind           public.post_kind not null default 'text',
  body           text not null default '',
  image_url      text,
  boosted_likes  int not null default 0,
  boosted_views  int not null default 0,
  view_count     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.channel_post_reactions (
  post_id    uuid not null references public.channel_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null default '❤️',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create table public.statuses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('image','video')),
  media_url  text not null,
  caption    text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table public.status_views (
  status_id  uuid not null references public.statuses(id) on delete cascade,
  viewer_id  uuid not null references auth.users(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (status_id, viewer_id)
);

create table public.status_reactions (
  status_id  uuid not null references public.statuses(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (status_id, user_id)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table public.admin_boosts (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references auth.users(id),
  post_type  text not null check (post_type in ('channel','group')),
  post_id    uuid not null,
  kind       public.boost_kind not null,
  amount     int not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  target_id   uuid not null,
  reason      text not null,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references auth.users(id),
  action      text not null,
  target_type text not null,
  target_id   uuid,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
```

## 4. Indexes

```sql
create index on public.user_roles              (user_id);
create index on public.chat_members            (user_id);
create index on public.messages                (chat_id, created_at desc);
create index on public.messages                (sender_id);
create index on public.messages                (reply_to);
create index on public.message_reactions       (message_id);
create index on public.groups                  (chat_id);
create index on public.group_members           (user_id);
create index on public.group_posts             (group_id, created_at desc);
create index on public.group_posts             (author_id);
create index on public.group_post_reactions    (post_id);
create index on public.channel_members         (user_id);
create index on public.channel_posts           (channel_id, created_at desc);
create index on public.channel_posts           (author_id);
create index on public.channel_post_reactions  (post_id);
create index on public.statuses                (user_id, created_at desc);
create index on public.statuses                (expires_at);
create index on public.status_views            (viewer_id);
create index on public.status_reactions        (user_id);
create index on public.notifications           (user_id, created_at desc);
create index on public.admin_boosts            (post_id);
create index on public.admin_boosts            (admin_id, created_at desc);
create index on public.reports                 (target_type, target_id);
create index on public.audit_logs              (admin_id, created_at desc);
```

## 5. has_role() SECURITY DEFINER helper

```sql
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;
```

## 6. updated_at trigger

```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'profiles','chats','messages','groups','group_posts',
      'channels','channel_posts'
    ])
  loop
    execute format(
      'create trigger trg_%1$s_updated_at
         before update on public.%1$s
         for each row execute function public.set_updated_at();',
      t
    );
  end loop;
end $$;
```

## 7. Row Level Security

```sql
-- Enable RLS on every table
alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.chats                 enable row level security;
alter table public.chat_members          enable row level security;
alter table public.messages              enable row level security;
alter table public.message_reactions     enable row level security;
alter table public.groups                enable row level security;
alter table public.group_members         enable row level security;
alter table public.group_posts           enable row level security;
alter table public.group_post_reactions  enable row level security;
alter table public.channels              enable row level security;
alter table public.channel_members       enable row level security;
alter table public.channel_posts         enable row level security;
alter table public.channel_post_reactions enable row level security;
alter table public.statuses              enable row level security;
alter table public.status_views          enable row level security;
alter table public.status_reactions      enable row level security;
alter table public.notifications         enable row level security;
alter table public.admin_boosts          enable row level security;
alter table public.reports               enable row level security;
alter table public.audit_logs            enable row level security;

-- profiles: everyone can read; users can update their own; admins can update anyone
create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "profiles admin update" on public.profiles for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "profiles self insert" on public.profiles for insert to authenticated with check (id = auth.uid());

-- user_roles: users can read their own row; only admins can write
create policy "roles self read"  on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "roles admin write" on public.user_roles for all    to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- chats: members only
create policy "chats select member" on public.chats for select to authenticated using (
  exists (select 1 from public.chat_members m where m.chat_id = chats.id and m.user_id = auth.uid())
);
create policy "chats insert self" on public.chats for insert to authenticated with check (true);
create policy "chats update admin" on public.chats for update to authenticated using (
  exists (select 1 from public.chat_members m where m.chat_id = chats.id and m.user_id = auth.uid())
);

create policy "chat_members select self" on public.chat_members for select to authenticated using (
  user_id = auth.uid() or public.is_chat_member(chat_id)
);
create policy "chat_members insert self" on public.chat_members for insert to authenticated with check (auth.role() = 'authenticated');
create policy "chat_members delete self" on public.chat_members for delete to authenticated using (user_id = auth.uid());

-- messages: only members of the chat may read/write; sender may edit/delete
create policy "messages select member" on public.messages for select to authenticated using (
  exists (select 1 from public.chat_members m where m.chat_id = messages.chat_id and m.user_id = auth.uid())
);
create policy "messages insert member" on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and exists (
    select 1 from public.chat_members m where m.chat_id = messages.chat_id and m.user_id = auth.uid()
  )
);
create policy "messages update own"    on public.messages for update to authenticated using (sender_id = auth.uid());
create policy "messages delete own"    on public.messages for delete to authenticated using (sender_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create policy "message_reactions rw" on public.message_reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "message_reactions read" on public.message_reactions for select to authenticated using (
  exists (
    select 1 from public.messages msg
    join public.chat_members m on m.chat_id = msg.chat_id
    where msg.id = message_reactions.message_id and m.user_id = auth.uid()
  )
);

-- groups
create policy "groups select member" on public.groups for select to authenticated using (
  exists (select 1 from public.group_members gm where gm.group_id = groups.id and gm.user_id = auth.uid())
);
create policy "groups insert owner"  on public.groups for insert to authenticated with check (owner_id = auth.uid());
create policy "groups update admin"  on public.groups for update to authenticated using (
  owner_id = auth.uid() or exists (
    select 1 from public.group_members gm where gm.group_id = groups.id and gm.user_id = auth.uid() and gm.is_admin
  )
);

create policy "group_members read"   on public.group_members for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.group_members gm where gm.group_id = group_members.group_id and gm.user_id = auth.uid()
  )
);
create policy "group_members insert" on public.group_members for insert to authenticated with check (
  exists (
    select 1 from public.groups g
    left join public.group_members gm on gm.group_id = g.id and gm.user_id = auth.uid() and gm.is_admin
    where g.id = group_members.group_id
      and (g.owner_id = auth.uid() or gm.user_id is not null or not g.only_admins_add)
  )
);
create policy "group_members leave"  on public.group_members for delete to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid()
  )
);

create policy "group_posts read"   on public.group_posts for select to authenticated using (
  exists (select 1 from public.group_members gm where gm.group_id = group_posts.group_id and gm.user_id = auth.uid())
);
create policy "group_posts insert" on public.group_posts for insert to authenticated with check (
  author_id = auth.uid() and exists (
    select 1 from public.groups g
    join public.group_members gm on gm.group_id = g.id and gm.user_id = auth.uid()
    where g.id = group_posts.group_id
      and (not g.only_admins_post or gm.is_admin or g.owner_id = auth.uid())
  )
);
create policy "group_posts update" on public.group_posts for update to authenticated using (
  author_id = auth.uid() or public.has_role(auth.uid(),'admin')
);
create policy "group_posts delete" on public.group_posts for delete to authenticated using (
  author_id = auth.uid() or public.has_role(auth.uid(),'admin')
);

create policy "group_post_reactions all" on public.group_post_reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "group_post_reactions read" on public.group_post_reactions for select to authenticated using (
  exists (
    select 1 from public.group_posts p
    join public.group_members gm on gm.group_id = p.group_id
    where p.id = group_post_reactions.post_id and gm.user_id = auth.uid()
  )
);

-- channels: publicly readable, only admins/owner can post
create policy "channels read"        on public.channels for select to authenticated using (true);
create policy "channels insert admin" on public.channels for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "channels update admin" on public.channels for update to authenticated using (
  owner_id = auth.uid() or public.has_role(auth.uid(),'admin')
);

create policy "channel_members read"    on public.channel_members for select to authenticated using (true);
create policy "channel_members join"    on public.channel_members for insert to authenticated with check (user_id = auth.uid());
create policy "channel_members leave"   on public.channel_members for delete to authenticated using (user_id = auth.uid());

create policy "channel_posts read"   on public.channel_posts for select to authenticated using (true);
create policy "channel_posts insert" on public.channel_posts for insert to authenticated with check (
  author_id = auth.uid() and (
    exists (
      select 1 from public.channels c
      left join public.channel_members cm on cm.channel_id = c.id and cm.user_id = auth.uid()
      where c.id = channel_posts.channel_id
        and (c.owner_id = auth.uid() or coalesce(cm.is_admin, false) or public.has_role(auth.uid(),'admin'))
    )
  )
);
create policy "channel_posts update" on public.channel_posts for update to authenticated using (
  author_id = auth.uid() or public.has_role(auth.uid(),'admin')
);
create policy "channel_posts delete" on public.channel_posts for delete to authenticated using (
  author_id = auth.uid() or public.has_role(auth.uid(),'admin')
);

create policy "channel_post_reactions all" on public.channel_post_reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "channel_post_reactions read" on public.channel_post_reactions for select to authenticated using (true);

-- statuses: everyone can read non-expired; owner can write; admins can delete any
create policy "statuses read active" on public.statuses for select to authenticated using (expires_at > now());
create policy "statuses read own"    on public.statuses for select to authenticated using (user_id = auth.uid());
create policy "statuses insert own"  on public.statuses for insert to authenticated with check (user_id = auth.uid());
create policy "statuses delete own"  on public.statuses for delete to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create policy "status_views read"    on public.status_views for select to authenticated using (
  viewer_id = auth.uid() or exists (select 1 from public.statuses s where s.id = status_views.status_id and s.user_id = auth.uid())
);
create policy "status_views insert"  on public.status_views for insert to authenticated with check (viewer_id = auth.uid());

create policy "status_reactions rw"  on public.status_reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "status_reactions read" on public.status_reactions for select to authenticated using (true);

-- notifications: only the recipient
create policy "notifications self" on public.notifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- admin-only tables
create policy "boosts admin"   on public.admin_boosts for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "reports insert self" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "reports read admin"  on public.reports for select to authenticated using (public.has_role(auth.uid(),'admin') or reporter_id = auth.uid());
create policy "reports update admin" on public.reports for update to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "audit admin read"    on public.audit_logs for select to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "audit admin write"   on public.audit_logs for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
```

## 8. Business logic functions

```sql
-- Boost a post (channel or group). Guarded against non-admins and non-positive amounts.
create or replace function public.boost_post(
  _post_type text,
  _post_id   uuid,
  _kind      public.boost_kind,
  _amount    int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins may boost posts';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'Boost amount must be greater than zero';
  end if;

  if _post_type = 'channel' then
    if _kind = 'likes' then
      update public.channel_posts set boosted_likes = boosted_likes + _amount where id = _post_id;
    else
      update public.channel_posts set boosted_views = boosted_views + _amount where id = _post_id;
    end if;
  elsif _post_type = 'group' then
    -- Group posts don't track like/view counters natively; we log the boost only.
    null;
  else
    raise exception 'Unknown post_type %', _post_type;
  end if;

  insert into public.admin_boosts (admin_id, post_type, post_id, kind, amount)
  values (auth.uid(), _post_type, _post_id, _kind, _amount);

  insert into public.audit_logs (admin_id, action, target_type, target_id, meta)
  values (auth.uid(), 'boost_post', _post_type || '_post', _post_id,
          jsonb_build_object('kind', _kind, 'amount', _amount));
end $$;

-- Mark all messages in a chat as read (soft ack — a real app would use a per-user cursor).
create or replace function public.mark_messages_read(_chat_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.messages
     set updated_at = now()
   where chat_id = _chat_id
     and sender_id <> auth.uid()
     and exists (select 1 from public.chat_members m where m.chat_id = _chat_id and m.user_id = auth.uid());
$$;

-- Delete rows for statuses past their TTL. Cron calls this hourly.
create or replace function public.delete_expired_statuses()
returns void language sql security definer set search_path = public as $$
  delete from public.statuses where expires_at <= now();
$$;
```

## 9. auth.users → profiles trigger

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

## 10. Realtime publication

```sql
alter publication supabase_realtime add table
  public.messages,
  public.statuses,
  public.status_views,
  public.channel_posts,
  public.channel_post_reactions,
  public.group_posts,
  public.group_post_reactions;
```

## 11. Storage: private status-media bucket

```sql
-- Create the bucket via the Supabase dashboard or the storage tool
-- (INSERT INTO storage.buckets is blocked). Use: name = 'status-media', public = false.

-- Only allow users to write files under their own uid/ prefix
create policy "status uploads self" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'status-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "status delete self" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'status-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read access only when a matching non-expired status row exists
create policy "status read active" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'status-media'
    and exists (
      select 1 from public.statuses s
      where s.media_url like '%' || storage.objects.name
        and s.expires_at > now()
    )
  );

-- Hard-delete expired files via the Storage API using pg_net.
create or replace function public.delete_expired_status_files()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  project_ref text := current_setting('app.settings.project_ref', true);
  service_key text := current_setting('app.settings.service_role_key', true);
begin
  for r in
    select id, media_url from public.statuses where expires_at <= now()
  loop
    perform net.http_delete(
      url     := 'https://' || project_ref || '.supabase.co/storage/v1/object/status-media/' || r.media_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key
      )
    );
  end loop;
end $$;
```

Set the two GUCs used above once (Dashboard → Database → Custom Config or via SQL):

```sql
alter database postgres set app.settings.project_ref     = 'YOUR_PROJECT_REF';
alter database postgres set app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

## 12. Hourly cleanup job

```sql
select cron.schedule(
  'cleanup-expired-statuses-hourly',
  '0 * * * *',
  $$ select public.delete_expired_statuses(); select public.delete_expired_status_files(); $$
);
```

## 13. GRANT statements

```sql
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on
  public.profiles, public.chats, public.chat_members, public.messages,
  public.message_reactions, public.groups, public.group_members, public.group_posts,
  public.group_post_reactions, public.channels, public.channel_members,
  public.channel_posts, public.channel_post_reactions, public.statuses,
  public.status_views, public.status_reactions, public.notifications,
  public.reports
to authenticated;

grant select on public.user_roles, public.admin_boosts, public.audit_logs to authenticated;
grant insert, update, delete on public.admin_boosts, public.audit_logs, public.user_roles to authenticated;
-- (Writes to admin_boosts/audit_logs/user_roles are further gated by RLS to admins only.)

grant all on
  public.profiles, public.user_roles, public.chats, public.chat_members,
  public.messages, public.message_reactions, public.groups, public.group_members,
  public.group_posts, public.group_post_reactions, public.channels,
  public.channel_members, public.channel_posts, public.channel_post_reactions,
  public.statuses, public.status_views, public.status_reactions, public.notifications,
  public.admin_boosts, public.reports, public.audit_logs
to service_role;
```

---

## Connecting the frontend

1. **Enable Lovable Cloud (Supabase).** From the Lovable dashboard, click "Enable Cloud". A project is provisioned automatically. Copy your `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.

2. **Environment variables** (the client uses the public/publishable key, the server uses the URL + publishable key; the service-role key is server-only):

   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_PUBLISHABLE_KEY=...
   SUPABASE_URL=...
   SUPABASE_PUBLISHABLE_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...   # server-only, never exposed to the browser
   ```

3. **Swap the mock API modules.** Every backend call in the app goes through a file in `src/api/`. To go live, rewrite the *inside* of each function — the exported names, arguments, and return shapes are already the ones a Supabase client would use:

   - `src/api/authApi.ts` → `supabase.auth.signInWithPassword`, `signUp`, `signOut`
   - `src/api/usersApi.ts` → `select ... from profiles`
   - `src/api/chatsApi.ts` → `select ... from chats join chat_members ...`
   - `src/api/messagesApi.ts` → `insert into messages` + `.channel('chat:'+id).on('postgres_changes',...)`
   - `src/api/statusApi.ts` → `insert/select statuses`, storage upload to `status-media`
   - `src/api/channelsApi.ts` → `select channels/channel_posts`, `.rpc('boost_post')` from the admin panel
   - `src/api/adminApi.ts` → gated by `has_role(auth.uid(),'admin')` policies; boost calls `rpc('boost_post', ...)`

   The event-bus subscribers (`subscribeToChat`, `subscribeToChannels`, `subscribeToStatuses`) map directly to Supabase Realtime channels: `supabase.channel('...').on('postgres_changes', ...).subscribe()` returning an `unsubscribe` closure. No consumer changes needed.

4. **Enable auth providers.** In the Supabase dashboard → Authentication → Providers:
   - **Email**: enabled by default. Turn on "Confirm email" for production.
   - **Google**: paste OAuth client ID/secret from Google Cloud Console. Add `https://<your-app>/auth/callback` as an authorized redirect URI.
   - Site URL and additional redirect URLs must include your production and preview domains.

5. **Storage bucket.** Create the `status-media` bucket (private) via the dashboard once. RLS on `storage.objects` is already covered above.

6. **Post-migration smoke test.** After running the SQL, sign up a fresh user in the app — the trigger should create both a `profiles` row and a `user_roles` row with `role = 'user'`. Manually insert `('<your-uid>', 'admin')` into `user_roles` to promote yourself, then reload and confirm the Admin nav entry appears.
