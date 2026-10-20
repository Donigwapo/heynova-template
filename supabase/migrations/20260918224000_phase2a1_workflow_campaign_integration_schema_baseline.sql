-- Phase 2A.1 Schema Baseline (workflow/campaign/integration scope)
--
-- IMPORTANT
-- - This baseline is intended to capture CURRENT PRODUCTION REALITY in source control.
-- - It is NOT a schema improvement migration.
-- - Do not apply this migration to an already-provisioned production database.
-- - It exists to make fresh environments reproducible and to anchor future forward migrations.

begin;

-- ============================================================
-- Tables
-- ============================================================

create table public.campaigns (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  status text default 'draft'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint campaigns_pkey primary key (id)
);

create table public.workflows (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  campaign_id uuid,
  name text not null,
  status text not null default 'draft'::text,
  trigger_type text not null default 'manual'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint workflows_pkey primary key (id),
  constraint workflows_campaign_id_fkey foreign key (campaign_id)
    references public.campaigns (id)
    on delete cascade
);

create table public.workflow_steps (
  id uuid not null default gen_random_uuid(),
  workflow_id uuid not null,
  user_id uuid not null,
  step_order integer not null,
  step_type text not null default 'email'::text,
  delay_days integer not null default 0,
  subject text,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint workflow_steps_pkey primary key (id),
  constraint workflow_steps_workflow_id_fkey foreign key (workflow_id)
    references public.workflows (id)
    on delete cascade,
  constraint workflow_steps_workflow_id_step_order_key unique (workflow_id, step_order)
);

create table public.workflow_delivery_outbox (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  workflow_id uuid not null,
  workflow_step_id uuid not null,
  campaign_id uuid not null,
  campaign_lead_id uuid not null,
  channel text not null default 'email'::text,
  status text not null default 'queued'::text,
  idempotency_key text not null,
  scheduled_at timestamp with time zone,
  sent_at timestamp with time zone,
  provider_message_id text,
  attempt_count integer not null default 0,
  last_attempt_at timestamp with time zone,
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  claimed_at timestamp with time zone,
  constraint workflow_delivery_outbox_pkey primary key (id),
  constraint workflow_delivery_outbox_idempotency_key_key unique (idempotency_key)
);

create table public.campaign_leads (
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  user_id uuid not null,
  lead_result_id uuid,
  linkedin_url text,
  full_name text,
  first_name text,
  last_name text,
  job_title text,
  company_name text,
  location text,
  profile_summary text,
  status text default 'new'::text,
  created_at timestamp with time zone default now(),
  email text,
  phone text,
  email_status text,
  email_confidence numeric,
  phone_status text,
  contact_source text,
  enrichment_metadata jsonb not null default '{}'::jsonb,
  constraint campaign_leads_pkey primary key (id),
  constraint campaign_leads_campaign_id_fkey foreign key (campaign_id)
    references public.campaigns (id)
    on delete cascade
);

create table public.integration_connections (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  connected_email text,
  access_token_enc text,
  refresh_token_enc text,
  scope text,
  expires_at timestamp with time zone,
  status text not null default 'connected'::text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint integration_connections_pkey primary key (id),
  constraint integration_connections_user_id_fkey foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint integration_connections_user_id_provider_key unique (user_id, provider)
);

create table public.integration_oauth_states (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  state_token text not null,
  return_path text not null default '/integrations'::text,
  status text not null default 'pending'::text,
  created_at timestamp with time zone not null default now(),
  used_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint integration_oauth_states_pkey primary key (id),
  constraint integration_oauth_states_user_id_fkey foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint integration_oauth_states_state_token_key unique (state_token)
);

-- ============================================================
-- Indexes (mirroring current live names/shapes)
-- ============================================================

create unique index campaign_leads_unique_linkedin
  on public.campaign_leads using btree (campaign_id, linkedin_url);

create index idx_workflows_user_id
  on public.workflows using btree (user_id);

create index idx_workflows_campaign_id
  on public.workflows using btree (campaign_id);

create index idx_workflow_steps_user_id
  on public.workflow_steps using btree (user_id);

create index idx_workflow_steps_workflow_id
  on public.workflow_steps using btree (workflow_id);

create index idx_workflow_delivery_outbox_queue
  on public.workflow_delivery_outbox using btree (status, scheduled_at);

create index idx_integration_connections_user_provider
  on public.integration_connections using btree (user_id, provider);

create index idx_integration_oauth_states_user_provider
  on public.integration_oauth_states using btree (user_id, provider);

-- ============================================================
-- RLS enablement
-- ============================================================

alter table public.campaigns enable row level security;
alter table public.campaign_leads enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_delivery_outbox enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_oauth_states enable row level security;

-- ============================================================
-- Policies (mirroring live names/roles/commands/expressions)
-- ============================================================

create policy "Users can manage own campaigns"
  on public.campaigns
  as permissive
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy "Users can manage own campaign leads"
  on public.campaign_leads
  as permissive
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy workflows_select_own
  on public.workflows
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy workflows_insert_own
  on public.workflows
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy workflows_update_own
  on public.workflows
  as permissive
  for update
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy workflows_delete_own
  on public.workflows
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));

create policy workflow_steps_select_own
  on public.workflow_steps
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy workflow_steps_insert_own
  on public.workflow_steps
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));

create policy workflow_steps_update_own
  on public.workflow_steps
  as permissive
  for update
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy workflow_steps_delete_own
  on public.workflow_steps
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));

create policy "Users can view own workflow delivery outbox"
  on public.workflow_delivery_outbox
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));

create policy "Users can insert own workflow delivery outbox"
  on public.workflow_delivery_outbox
  as permissive
  for insert
  to public
  with check ((auth.uid() = user_id));

create policy "Users can update own workflow delivery outbox"
  on public.workflow_delivery_outbox
  as permissive
  for update
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

create policy integration_connections_select_own
  on public.integration_connections
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));

create policy integration_oauth_states_select_own
  on public.integration_oauth_states
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));

commit;
