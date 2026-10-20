-- Phase 2B.2: Immutable Workflow Definition Versioning (shadow-mode foundation)
-- Additive migration only.

-- 1) Immutable workflow version header
create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version_number integer not null,
  status text not null default 'published',
  source_workflow_updated_at timestamptz null,
  trigger_type text null,
  definition_hash text not null,
  published_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_versions_status_check check (status in ('snapshot', 'published', 'superseded')),
  constraint workflow_versions_version_number_check check (version_number >= 1)
);

create unique index if not exists uq_workflow_versions_workflow_version_number
  on public.workflow_versions (workflow_id, version_number);

create unique index if not exists uq_workflow_versions_workflow_definition_hash
  on public.workflow_versions (workflow_id, definition_hash);

create index if not exists idx_workflow_versions_user_workflow_created
  on public.workflow_versions (user_id, workflow_id, created_at desc);

create index if not exists idx_workflow_versions_workflow_published
  on public.workflow_versions (workflow_id, published_at desc);

-- 2) Immutable workflow version steps
create table if not exists public.workflow_version_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workflow_version_id uuid not null references public.workflow_versions(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  source_workflow_step_id uuid null,
  step_order integer not null,
  step_type text not null,
  delay_days integer not null default 0,
  subject text null,
  body text null,
  metadata jsonb not null default '{}'::jsonb,
  definition_hash text null,
  created_at timestamptz not null default now(),
  constraint workflow_version_steps_step_order_check check (step_order >= 0),
  constraint workflow_version_steps_delay_days_check check (delay_days >= 0),
  constraint workflow_version_steps_unique_per_version_order unique (workflow_version_id, step_order)
);

create index if not exists idx_workflow_version_steps_workflow_version
  on public.workflow_version_steps (workflow_version_id, step_order);

create index if not exists idx_workflow_version_steps_user_workflow
  on public.workflow_version_steps (user_id, workflow_id, step_order);

create index if not exists idx_workflow_version_steps_source_step_id
  on public.workflow_version_steps (source_workflow_step_id);

-- 3) Execution provenance fields (additive)
alter table public.workflow_runs
  add column if not exists workflow_version_id uuid null references public.workflow_versions(id) on delete set null;

create index if not exists idx_workflow_runs_workflow_version_id
  on public.workflow_runs (workflow_version_id);

alter table public.workflow_run_steps
  add column if not exists workflow_version_id uuid null references public.workflow_versions(id) on delete set null,
  add column if not exists workflow_version_step_id uuid null references public.workflow_version_steps(id) on delete set null;

create index if not exists idx_workflow_run_steps_workflow_version_id
  on public.workflow_run_steps (workflow_version_id);

create index if not exists idx_workflow_run_steps_workflow_version_step_id
  on public.workflow_run_steps (workflow_version_step_id);

alter table public.workflow_jobs
  add column if not exists workflow_version_id uuid null references public.workflow_versions(id) on delete set null,
  add column if not exists workflow_version_step_id uuid null references public.workflow_version_steps(id) on delete set null;

create index if not exists idx_workflow_jobs_workflow_version_id
  on public.workflow_jobs (workflow_version_id);

create index if not exists idx_workflow_jobs_workflow_version_step_id
  on public.workflow_jobs (workflow_version_step_id);

-- 4) RLS for immutable version tables: SELECT own only
alter table public.workflow_versions enable row level security;
alter table public.workflow_version_steps enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='workflow_versions' and policyname='workflow_versions_select_own'
  ) then
    create policy workflow_versions_select_own
      on public.workflow_versions
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='workflow_version_steps' and policyname='workflow_version_steps_select_own'
  ) then
    create policy workflow_version_steps_select_own
      on public.workflow_version_steps
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

-- 5) Ensure-version helper (transactional, immutable snapshot creation)
create or replace function public.ensure_workflow_version(
  p_user_id uuid,
  p_workflow_id uuid,
  p_status text default 'published'
)
returns table (
  workflow_version_id uuid,
  version_number integer,
  definition_hash text,
  reused boolean,
  step_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow public.workflows%rowtype;
  v_steps jsonb;
  v_hash text;
  v_existing public.workflow_versions%rowtype;
  v_inserted public.workflow_versions%rowtype;
  v_version_number integer;
  v_step_count integer;
begin
  -- lock workflow row to serialize per-workflow version creation
  select *
    into v_workflow
  from public.workflows
  where id = p_workflow_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Workflow not found for user.' using errcode = 'P0002';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'step_order', ws.step_order,
               'step_type', ws.step_type,
               'delay_days', ws.delay_days,
               'subject', ws.subject,
               'body', ws.body,
               'metadata', coalesce(ws.metadata, '{}'::jsonb)
             )
             order by ws.step_order asc
           ),
           '[]'::jsonb
         )
    into v_steps
  from public.workflow_steps ws
  where ws.workflow_id = p_workflow_id
    and ws.user_id = p_user_id;

  v_step_count := jsonb_array_length(v_steps);

  if v_step_count = 0 then
    raise exception 'Workflow has no steps to snapshot.' using errcode = 'P0001';
  end if;

  v_hash := encode(digest(v_steps::text, 'sha256'), 'hex');

  select *
    into v_existing
  from public.workflow_versions
  where workflow_id = p_workflow_id
    and definition_hash = v_hash
  order by version_number desc
  limit 1;

  if found then
    return query
    select v_existing.id, v_existing.version_number, v_existing.definition_hash, true, v_step_count;
    return;
  end if;

  v_version_number := coalesce((
    select max(version_number) + 1
    from public.workflow_versions
    where workflow_id = p_workflow_id
  ), 1);

  insert into public.workflow_versions (
    user_id,
    workflow_id,
    version_number,
    status,
    source_workflow_updated_at,
    trigger_type,
    definition_hash,
    published_at,
    metadata
  ) values (
    p_user_id,
    p_workflow_id,
    v_version_number,
    case when p_status in ('snapshot', 'published', 'superseded') then p_status else 'published' end,
    v_workflow.updated_at,
    v_workflow.trigger_type,
    v_hash,
    now(),
    jsonb_build_object(
      'shadow_mode', true,
      'created_by', 'ensure_workflow_version',
      'step_count', v_step_count
    )
  )
  returning * into v_inserted;

  insert into public.workflow_version_steps (
    user_id,
    workflow_version_id,
    workflow_id,
    source_workflow_step_id,
    step_order,
    step_type,
    delay_days,
    subject,
    body,
    metadata,
    definition_hash
  )
  select
    ws.user_id,
    v_inserted.id,
    ws.workflow_id,
    ws.id,
    ws.step_order,
    ws.step_type,
    ws.delay_days,
    ws.subject,
    ws.body,
    coalesce(ws.metadata, '{}'::jsonb),
    encode(
      digest(
        jsonb_build_object(
          'step_order', ws.step_order,
          'step_type', ws.step_type,
          'delay_days', ws.delay_days,
          'subject', ws.subject,
          'body', ws.body,
          'metadata', coalesce(ws.metadata, '{}'::jsonb)
        )::text,
        'sha256'
      ),
      'hex'
    )
  from public.workflow_steps ws
  where ws.workflow_id = p_workflow_id
    and ws.user_id = p_user_id
  order by ws.step_order asc;

  return query
  select v_inserted.id, v_inserted.version_number, v_inserted.definition_hash, false, v_step_count;

exception
  when unique_violation then
    select *
      into v_existing
    from public.workflow_versions
    where workflow_id = p_workflow_id
      and definition_hash = v_hash
    order by version_number desc
    limit 1;

    if found then
      return query
      select v_existing.id, v_existing.version_number, v_existing.definition_hash, true, v_step_count;
      return;
    end if;

    raise;
end;
$$;

revoke all on function public.ensure_workflow_version(uuid, uuid, text) from public;
revoke all on function public.ensure_workflow_version(uuid, uuid, text) from anon;
revoke all on function public.ensure_workflow_version(uuid, uuid, text) from authenticated;
grant execute on function public.ensure_workflow_version(uuid, uuid, text) to service_role;
