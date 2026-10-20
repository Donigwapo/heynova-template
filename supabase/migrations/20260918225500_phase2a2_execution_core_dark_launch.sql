-- Phase 2A.2 - Heynova Execution Core (dark-launch schema only)
--
-- IMPORTANT:
-- - Schema-only addition.
-- - No runtime wiring in this migration.
-- - Does not modify existing workflow/campaign/outbox/integration behavior.

begin;

-- ============================================================
-- 1) workflow_runs
-- ============================================================

create table public.workflow_runs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  workflow_id uuid not null,
  campaign_id uuid,
  campaign_lead_id uuid,

  status text not null default 'pending'::text,
  trigger_type text,
  trigger_ref jsonb,
  current_step_ref jsonb,
  metadata jsonb not null default '{}'::jsonb,

  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,

  last_error_code text,
  last_error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workflow_runs_pkey primary key (id),
  constraint workflow_runs_workflow_id_fkey
    foreign key (workflow_id) references public.workflows(id) on delete cascade,
  constraint workflow_runs_campaign_id_fkey
    foreign key (campaign_id) references public.campaigns(id) on delete set null,
  constraint workflow_runs_campaign_lead_id_fkey
    foreign key (campaign_lead_id) references public.campaign_leads(id) on delete set null,

  constraint workflow_runs_status_check
    check (status in ('pending','running','paused','completed','failed','cancelled'))
);

create index idx_workflow_runs_user_id
  on public.workflow_runs using btree (user_id);

create index idx_workflow_runs_workflow_id
  on public.workflow_runs using btree (workflow_id);

create index idx_workflow_runs_campaign_id
  on public.workflow_runs using btree (campaign_id);

create index idx_workflow_runs_campaign_lead_id
  on public.workflow_runs using btree (campaign_lead_id);

create index idx_workflow_runs_user_status_created
  on public.workflow_runs using btree (user_id, status, created_at desc);

-- Optional active-run guard (future-safe): prevents duplicate simultaneously-active runs
-- while preserving unlimited historical runs.
create unique index uq_workflow_runs_active_per_lead
  on public.workflow_runs (user_id, workflow_id, campaign_lead_id)
  where campaign_lead_id is not null
    and status in ('pending','running','paused');

-- ============================================================
-- 2) workflow_run_steps
-- ============================================================

create table public.workflow_run_steps (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  workflow_run_id uuid not null,
  workflow_id uuid not null,

  -- Current linear workflow linkage
  workflow_step_id uuid,

  -- Future graph compatibility (no FK yet; graph tables do not exist yet)
  workflow_node_id uuid,
  workflow_edge_id uuid,

  path_key text,
  sequence_no integer,
  visit_no integer,

  status text not null default 'pending'::text,

  scheduled_at timestamptz,
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,

  attempt_count integer not null default 0,
  max_attempts integer not null default 5,

  last_error_code text,
  last_error_message text,

  input_snapshot jsonb,
  output_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workflow_run_steps_pkey primary key (id),
  constraint workflow_run_steps_workflow_run_id_fkey
    foreign key (workflow_run_id) references public.workflow_runs(id) on delete cascade,
  constraint workflow_run_steps_workflow_id_fkey
    foreign key (workflow_id) references public.workflows(id) on delete cascade,
  constraint workflow_run_steps_workflow_step_id_fkey
    foreign key (workflow_step_id) references public.workflow_steps(id) on delete set null,

  constraint workflow_run_steps_status_check
    check (status in ('pending','scheduled','running','completed','failed','skipped','cancelled','blocked')),
  constraint workflow_run_steps_sequence_no_check
    check (sequence_no is null or sequence_no >= 0),
  constraint workflow_run_steps_visit_no_check
    check (visit_no is null or visit_no >= 1),
  constraint workflow_run_steps_attempt_count_check
    check (attempt_count >= 0),
  constraint workflow_run_steps_max_attempts_check
    check (max_attempts >= 0)
);

create index idx_workflow_run_steps_user_id
  on public.workflow_run_steps using btree (user_id);

create index idx_workflow_run_steps_run_id_created
  on public.workflow_run_steps using btree (workflow_run_id, created_at);

create index idx_workflow_run_steps_run_status_scheduled
  on public.workflow_run_steps using btree (workflow_run_id, status, scheduled_at);

create index idx_workflow_run_steps_user_status_scheduled
  on public.workflow_run_steps using btree (user_id, status, scheduled_at);

create index idx_workflow_run_steps_workflow_step_id
  on public.workflow_run_steps using btree (workflow_step_id);

create index idx_workflow_run_steps_workflow_node_id
  on public.workflow_run_steps using btree (workflow_node_id);

-- ============================================================
-- 3) workflow_jobs
-- ============================================================

create table public.workflow_jobs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,

  workflow_run_id uuid not null,
  workflow_run_step_id uuid,
  workflow_id uuid not null,
  campaign_id uuid,
  campaign_lead_id uuid,

  job_type text not null,
  queue_name text not null,
  priority integer not null default 100,
  status text not null default 'scheduled'::text,

  scheduled_at timestamptz,
  available_at timestamptz,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  claimed_by text,
  claim_token uuid,

  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,

  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz,

  last_error_code text,
  last_error_message text,
  last_error_details jsonb,

  idempotency_key text,

  payload jsonb not null default '{}'::jsonb,
  result jsonb,

  external_ref_type text,
  external_ref_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workflow_jobs_pkey primary key (id),
  constraint workflow_jobs_workflow_run_id_fkey
    foreign key (workflow_run_id) references public.workflow_runs(id) on delete cascade,
  constraint workflow_jobs_workflow_run_step_id_fkey
    foreign key (workflow_run_step_id) references public.workflow_run_steps(id) on delete set null,
  constraint workflow_jobs_workflow_id_fkey
    foreign key (workflow_id) references public.workflows(id) on delete cascade,
  constraint workflow_jobs_campaign_id_fkey
    foreign key (campaign_id) references public.campaigns(id) on delete set null,
  constraint workflow_jobs_campaign_lead_id_fkey
    foreign key (campaign_lead_id) references public.campaign_leads(id) on delete set null,

  constraint workflow_jobs_status_check
    check (status in ('scheduled','queued','claimed','running','succeeded','retry_scheduled','dead_letter','cancelled')),
  constraint workflow_jobs_attempt_count_check
    check (attempt_count >= 0),
  constraint workflow_jobs_max_attempts_check
    check (max_attempts >= 0)
);

-- Idempotency: unique logical identity per user.
-- Retries stay on the same row via attempt_count, so this does not block retry attempts.
create unique index uq_workflow_jobs_user_idempotency_key
  on public.workflow_jobs (user_id, idempotency_key)
  where idempotency_key is not null;

-- Scheduler scan (time-based wakeups, retry wakes)
create index idx_workflow_jobs_status_scheduled_at
  on public.workflow_jobs using btree (status, scheduled_at);

-- Ready-to-claim queue scan
create index idx_workflow_jobs_claim_ready
  on public.workflow_jobs using btree (queue_name, status, priority desc, available_at, created_at)
  where status = 'queued';

-- Lease expiry recovery for crashed workers
create index idx_workflow_jobs_lease_expiry
  on public.workflow_jobs using btree (status, lease_expires_at)
  where status in ('claimed','running');

-- Run tracing / timeline
create index idx_workflow_jobs_run_created
  on public.workflow_jobs using btree (workflow_run_id, created_at);

-- User fairness / queue partitioning support
create index idx_workflow_jobs_user_queue_status
  on public.workflow_jobs using btree (user_id, queue_name, status, created_at);

-- ============================================================
-- 4) workflow_events
-- ============================================================

create table public.workflow_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,

  workflow_run_id uuid,
  workflow_run_step_id uuid,
  workflow_job_id uuid,
  workflow_id uuid,
  campaign_id uuid,
  campaign_lead_id uuid,

  event_type text not null,
  event_source text,
  severity text not null default 'info'::text,
  correlation_id text,
  idempotency_key text,

  payload jsonb,

  error_code text,
  error_message text,
  error_details jsonb,

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint workflow_events_pkey primary key (id),
  constraint workflow_events_workflow_run_id_fkey
    foreign key (workflow_run_id) references public.workflow_runs(id) on delete set null,
  constraint workflow_events_workflow_run_step_id_fkey
    foreign key (workflow_run_step_id) references public.workflow_run_steps(id) on delete set null,
  constraint workflow_events_workflow_job_id_fkey
    foreign key (workflow_job_id) references public.workflow_jobs(id) on delete set null,
  constraint workflow_events_workflow_id_fkey
    foreign key (workflow_id) references public.workflows(id) on delete set null,
  constraint workflow_events_campaign_id_fkey
    foreign key (campaign_id) references public.campaigns(id) on delete set null,
  constraint workflow_events_campaign_lead_id_fkey
    foreign key (campaign_lead_id) references public.campaign_leads(id) on delete set null,

  constraint workflow_events_severity_check
    check (severity in ('debug','info','warn','error'))
);

create index idx_workflow_events_user_occurred
  on public.workflow_events using btree (user_id, occurred_at desc);

create index idx_workflow_events_run_occurred
  on public.workflow_events using btree (workflow_run_id, occurred_at);

create index idx_workflow_events_job_occurred
  on public.workflow_events using btree (workflow_job_id, occurred_at);

create index idx_workflow_events_type_occurred
  on public.workflow_events using btree (event_type, occurred_at desc);

create index idx_workflow_events_correlation_id
  on public.workflow_events using btree (correlation_id)
  where correlation_id is not null;

-- Optional dedupe support for event producers when supplied.
create unique index uq_workflow_events_user_idempotency_key
  on public.workflow_events (user_id, idempotency_key)
  where idempotency_key is not null;

-- ============================================================
-- RLS (dark-launch safe)
-- ============================================================

alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;
alter table public.workflow_jobs enable row level security;
alter table public.workflow_events enable row level security;

-- Read-only client visibility for own records.
-- Writes are intentionally not granted to authenticated clients yet;
-- service-role backend execution can write during future rollout.
create policy workflow_runs_select_own
  on public.workflow_runs
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy workflow_run_steps_select_own
  on public.workflow_run_steps
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy workflow_jobs_select_own
  on public.workflow_jobs
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

create policy workflow_events_select_own
  on public.workflow_events
  as permissive
  for select
  to authenticated
  using ((auth.uid() = user_id));

commit;
