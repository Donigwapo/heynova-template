-- Google Calendar Integration Phase 1
-- Creates OAuth state + integration connection storage and meetings sync columns/indexes.

-- 1) OAuth transient state storage
create table if not exists public.integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  state_token text not null unique,
  return_path text not null default '/integrations',
  status text not null default 'pending', -- pending | used | expired
  created_at timestamptz not null default now(),
  used_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_integration_oauth_states_user_provider
  on public.integration_oauth_states(user_id, provider);

-- 2) Integration connection storage (server-side token persistence)
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  connected_email text,
  access_token_enc text,
  refresh_token_enc text,
  scope text,
  expires_at timestamptz,
  status text not null default 'connected', -- connected | disconnected | error
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists idx_integration_connections_user_provider
  on public.integration_connections(user_id, provider);

-- 3) Meetings table additions for provider sync
-- NOTE:
-- - meeting_date already exists in current schema and remains canonical start timestamp.
-- - participants already exists as text[] in current schema and is intentionally preserved.
alter table public.meetings
  add column if not exists external_event_id text,
  add column if not exists integration_source text,
  add column if not exists ends_at timestamptz,
  add column if not exists organizer_email text,
  add column if not exists raw_provider_payload jsonb,
  add column if not exists provider_html_link text,
  add column if not exists status text;

-- 4) Unique identity for dedup/upsert from provider
-- IMPORTANT: ON CONFLICT requires a matching non-partial unique index/constraint.
-- Drop prior partial index shape (if present), then create full unique index.
drop index if exists public.uq_meetings_user_provider_event;

create unique index if not exists uq_meetings_user_provider_event
  on public.meetings(user_id, integration_source, external_event_id);

-- 5) Optional: updated_at helper defaults (if not already managed)
alter table public.integration_connections
  alter column updated_at set default now();

alter table public.integration_oauth_states
  alter column updated_at set default now();

-- 6) RLS policies (if RLS enabled, basic user ownership access)
alter table public.integration_connections enable row level security;
alter table public.integration_oauth_states enable row level security;

-- Read own connections
create policy if not exists integration_connections_select_own
  on public.integration_connections
  for select
  using (auth.uid() = user_id);

-- Read own oauth states
create policy if not exists integration_oauth_states_select_own
  on public.integration_oauth_states
  for select
  using (auth.uid() = user_id);

-- NOTE:
-- Writes are done with service-role from Edge Functions, so no insert/update policy is required for anon/auth user roles.
