create table if not exists public.dashboards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dashboards enable row level security;

create policy "Users can read their own dashboard"
  on public.dashboards
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own dashboard"
  on public.dashboards
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own dashboard"
  on public.dashboards
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own dashboard"
  on public.dashboards
  for delete
  to authenticated
  using (auth.uid() = user_id);
