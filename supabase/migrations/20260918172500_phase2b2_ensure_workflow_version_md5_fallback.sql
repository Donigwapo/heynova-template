-- Phase 2B.2 fix: remove digest() dependency and use deterministic md5 over canonical JSON text.
-- Additive forward fix via CREATE OR REPLACE FUNCTION.

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

  v_hash := md5(v_steps::text);

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
    md5(
      jsonb_build_object(
        'step_order', ws.step_order,
        'step_type', ws.step_type,
        'delay_days', ws.delay_days,
        'subject', ws.subject,
        'body', ws.body,
        'metadata', coalesce(ws.metadata, '{}'::jsonb)
      )::text
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
