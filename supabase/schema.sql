-- Профили
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin')),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

-- Метки
create table public.markers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  type text not null check (type in ('traffic','accident','repair','closure','danger','other')),
  title text not null check (char_length(title) between 3 and 120),
  description text check (char_length(description) <= 1000),
  status text not null default 'active' check (status in ('active','expired','hidden')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours'),
  confirmations_count int not null default 0
);

create table public.confirmations (
  id uuid primary key default gen_random_uuid(),
  marker_id uuid not null references public.markers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (marker_id, user_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  marker_id uuid not null references public.markers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('false_info','spam','inappropriate','other')),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);

create index markers_coords_idx on public.markers (latitude, longitude);
create index markers_status_idx on public.markers (status, created_at desc);

-- RLS
alter table public.profiles enable row level security;
alter table public.markers enable row level security;
alter table public.confirmations enable row level security;
alter table public.reports enable row level security;

create policy "profiles_own_select" on public.profiles for select using (auth.uid() = id);
create policy "profiles_own_update" on public.profiles for update using (auth.uid() = id);
create policy "profiles_own_insert" on public.profiles for insert with check (auth.uid() = id);

create policy "markers_select" on public.markers for select using (
  status = 'active' or user_id = auth.uid() or
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "markers_insert_own" on public.markers for insert with check (auth.uid() = user_id);
create policy "markers_update_own" on public.markers for update using (auth.uid() = user_id);
create policy "markers_delete_own" on public.markers for delete using (auth.uid() = user_id);

create policy "confirmations_select" on public.confirmations for select using (true);
create policy "confirmations_insert" on public.confirmations for insert with check (auth.uid() = user_id);

create policy "reports_insert" on public.reports for insert with check (auth.uid() = user_id);
create policy "reports_select_admin" on public.reports for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Триггер счётчика подтверждений
create or replace function public.bump_confirms() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.markers set confirmations_count = confirmations_count + 1 where id = new.marker_id;
  else
    update public.markers set confirmations_count = confirmations_count - 1 where id = old.marker_id;
  end if;
  return null;
end; $$ language plpgsql security definer;

create trigger trg_confirms after insert or delete on public.confirmations
  for each row execute function public.bump_confirms();

-- Авто-создание профиля при регистрации
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  return new;
end; $$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Realtime
alter publication supabase_realtime add table public.markers;
