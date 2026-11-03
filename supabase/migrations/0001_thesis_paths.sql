create table if not exists public.thesis_paths (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint thesis_paths_size check (pg_column_size(data) < 5000000)
);

alter table public.thesis_paths enable row level security;

revoke all on public.thesis_paths from anon;
grant select, insert, update, delete on public.thesis_paths to authenticated;

create policy "read own path" on public.thesis_paths
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "add own path" on public.thesis_paths
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "change own path" on public.thesis_paths
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own path" on public.thesis_paths
  for delete to authenticated using ((select auth.uid()) = user_id);
