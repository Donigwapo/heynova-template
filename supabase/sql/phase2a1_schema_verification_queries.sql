-- Phase 2A.1 schema verification queries (READ-ONLY)
--
-- Purpose:
--   Detect drift between an environment and the approved Phase 2A.1 baseline
--   for workflow/campaign/integration tables.
--
-- Usage examples:
--   supabase db query --linked -f supabase/sql/phase2a1_schema_verification_queries.sql
--   supabase db query --local  -f supabase/sql/phase2a1_schema_verification_queries.sql

-- ============================================================
-- 0) Scope
-- ============================================================

with scope(table_name) as (
  values
    ('workflows'::text),
    ('workflow_steps'::text),
    ('workflow_delivery_outbox'::text),
    ('campaigns'::text),
    ('campaign_leads'::text),
    ('integration_connections'::text),
    ('integration_oauth_states'::text)
)
select * from scope order by table_name;

-- ============================================================
-- 1) Columns/type/default/nullability drift
-- ============================================================

with expected(table_name, column_name, data_type, udt_name, is_nullable, column_default) as (
  values
    ('campaign_leads','id','uuid','uuid','NO','gen_random_uuid()'),
    ('campaign_leads','campaign_id','uuid','uuid','NO',null),
    ('campaign_leads','user_id','uuid','uuid','NO',null),
    ('campaign_leads','lead_result_id','uuid','uuid','YES',null),
    ('campaign_leads','linkedin_url','text','text','YES',null),
    ('campaign_leads','full_name','text','text','YES',null),
    ('campaign_leads','first_name','text','text','YES',null),
    ('campaign_leads','last_name','text','text','YES',null),
    ('campaign_leads','job_title','text','text','YES',null),
    ('campaign_leads','company_name','text','text','YES',null),
    ('campaign_leads','location','text','text','YES',null),
    ('campaign_leads','profile_summary','text','text','YES',null),
    ('campaign_leads','status','text','text','YES','''new''::text'),
    ('campaign_leads','created_at','timestamp with time zone','timestamptz','YES','now()'),
    ('campaign_leads','email','text','text','YES',null),
    ('campaign_leads','phone','text','text','YES',null),
    ('campaign_leads','email_status','text','text','YES',null),
    ('campaign_leads','email_confidence','numeric','numeric','YES',null),
    ('campaign_leads','phone_status','text','text','YES',null),
    ('campaign_leads','contact_source','text','text','YES',null),
    ('campaign_leads','enrichment_metadata','jsonb','jsonb','NO','''{}''::jsonb'),

    ('campaigns','id','uuid','uuid','NO','gen_random_uuid()'),
    ('campaigns','user_id','uuid','uuid','NO',null),
    ('campaigns','name','text','text','NO',null),
    ('campaigns','status','text','text','YES','''draft''::text'),
    ('campaigns','created_at','timestamp with time zone','timestamptz','YES','now()'),
    ('campaigns','updated_at','timestamp with time zone','timestamptz','YES','now()'),

    ('integration_connections','id','uuid','uuid','NO','gen_random_uuid()'),
    ('integration_connections','user_id','uuid','uuid','NO',null),
    ('integration_connections','provider','text','text','NO',null),
    ('integration_connections','connected_email','text','text','YES',null),
    ('integration_connections','access_token_enc','text','text','YES',null),
    ('integration_connections','refresh_token_enc','text','text','YES',null),
    ('integration_connections','scope','text','text','YES',null),
    ('integration_connections','expires_at','timestamp with time zone','timestamptz','YES',null),
    ('integration_connections','status','text','text','NO','''connected''::text'),
    ('integration_connections','last_synced_at','timestamp with time zone','timestamptz','YES',null),
    ('integration_connections','created_at','timestamp with time zone','timestamptz','NO','now()'),
    ('integration_connections','updated_at','timestamp with time zone','timestamptz','NO','now()'),

    ('integration_oauth_states','id','uuid','uuid','NO','gen_random_uuid()'),
    ('integration_oauth_states','user_id','uuid','uuid','NO',null),
    ('integration_oauth_states','provider','text','text','NO',null),
    ('integration_oauth_states','state_token','text','text','NO',null),
    ('integration_oauth_states','return_path','text','text','NO','''/integrations''::text'),
    ('integration_oauth_states','status','text','text','NO','''pending''::text'),
    ('integration_oauth_states','created_at','timestamp with time zone','timestamptz','NO','now()'),
    ('integration_oauth_states','used_at','timestamp with time zone','timestamptz','YES',null),
    ('integration_oauth_states','updated_at','timestamp with time zone','timestamptz','NO','now()'),

    ('workflow_delivery_outbox','id','uuid','uuid','NO','gen_random_uuid()'),
    ('workflow_delivery_outbox','user_id','uuid','uuid','NO',null),
    ('workflow_delivery_outbox','workflow_id','uuid','uuid','NO',null),
    ('workflow_delivery_outbox','workflow_step_id','uuid','uuid','NO',null),
    ('workflow_delivery_outbox','campaign_id','uuid','uuid','NO',null),
    ('workflow_delivery_outbox','campaign_lead_id','uuid','uuid','NO',null),
    ('workflow_delivery_outbox','channel','text','text','NO','''email''::text'),
    ('workflow_delivery_outbox','status','text','text','NO','''queued''::text'),
    ('workflow_delivery_outbox','idempotency_key','text','text','NO',null),
    ('workflow_delivery_outbox','scheduled_at','timestamp with time zone','timestamptz','YES',null),
    ('workflow_delivery_outbox','sent_at','timestamp with time zone','timestamptz','YES',null),
    ('workflow_delivery_outbox','provider_message_id','text','text','YES',null),
    ('workflow_delivery_outbox','attempt_count','integer','int4','NO','0'),
    ('workflow_delivery_outbox','last_attempt_at','timestamp with time zone','timestamptz','YES',null),
    ('workflow_delivery_outbox','error_code','text','text','YES',null),
    ('workflow_delivery_outbox','error_message','text','text','YES',null),
    ('workflow_delivery_outbox','payload','jsonb','jsonb','NO','''{}''::jsonb'),
    ('workflow_delivery_outbox','created_at','timestamp with time zone','timestamptz','NO','now()'),
    ('workflow_delivery_outbox','updated_at','timestamp with time zone','timestamptz','NO','now()'),
    ('workflow_delivery_outbox','claimed_at','timestamp with time zone','timestamptz','YES',null),

    ('workflow_steps','id','uuid','uuid','NO','gen_random_uuid()'),
    ('workflow_steps','workflow_id','uuid','uuid','NO',null),
    ('workflow_steps','user_id','uuid','uuid','NO',null),
    ('workflow_steps','step_order','integer','int4','NO',null),
    ('workflow_steps','step_type','text','text','NO','''email''::text'),
    ('workflow_steps','delay_days','integer','int4','NO','0'),
    ('workflow_steps','subject','text','text','YES',null),
    ('workflow_steps','body','text','text','YES',null),
    ('workflow_steps','metadata','jsonb','jsonb','NO','''{}''::jsonb'),
    ('workflow_steps','created_at','timestamp with time zone','timestamptz','NO','now()'),
    ('workflow_steps','updated_at','timestamp with time zone','timestamptz','NO','now()'),

    ('workflows','id','uuid','uuid','NO','gen_random_uuid()'),
    ('workflows','user_id','uuid','uuid','NO',null),
    ('workflows','campaign_id','uuid','uuid','YES',null),
    ('workflows','name','text','text','NO',null),
    ('workflows','status','text','text','NO','''draft''::text'),
    ('workflows','trigger_type','text','text','NO','''manual''::text'),
    ('workflows','created_at','timestamp with time zone','timestamptz','NO','now()'),
    ('workflows','updated_at','timestamp with time zone','timestamptz','NO','now()')
),
actual as (
  select table_name, column_name, data_type, udt_name, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name in (
      'workflows','workflow_steps','workflow_delivery_outbox','campaigns','campaign_leads','integration_connections','integration_oauth_states'
    )
)
select 'missing_in_actual' as diff_type, * from expected
except
select 'missing_in_actual' as diff_type, * from actual
union all
select 'unexpected_in_actual' as diff_type, * from actual
except
select 'unexpected_in_actual' as diff_type, * from expected
order by diff_type, table_name, column_name;

-- ============================================================
-- 2) PK / UNIQUE / FK drift
-- ============================================================

with expected(table_name, constraint_name, constraint_type, columns) as (
  values
    ('campaign_leads','campaign_leads_campaign_id_fkey','FOREIGN KEY','campaign_id'),
    ('campaign_leads','campaign_leads_pkey','PRIMARY KEY','id'),
    ('campaigns','campaigns_pkey','PRIMARY KEY','id'),
    ('integration_connections','integration_connections_user_id_fkey','FOREIGN KEY','user_id'),
    ('integration_connections','integration_connections_pkey','PRIMARY KEY','id'),
    ('integration_connections','integration_connections_user_id_provider_key','UNIQUE','user_id,provider'),
    ('integration_oauth_states','integration_oauth_states_user_id_fkey','FOREIGN KEY','user_id'),
    ('integration_oauth_states','integration_oauth_states_pkey','PRIMARY KEY','id'),
    ('integration_oauth_states','integration_oauth_states_state_token_key','UNIQUE','state_token'),
    ('workflow_delivery_outbox','workflow_delivery_outbox_idempotency_key_key','UNIQUE','idempotency_key'),
    ('workflow_delivery_outbox','workflow_delivery_outbox_pkey','PRIMARY KEY','id'),
    ('workflow_steps','workflow_steps_pkey','PRIMARY KEY','id'),
    ('workflow_steps','workflow_steps_workflow_id_fkey','FOREIGN KEY','workflow_id'),
    ('workflow_steps','workflow_steps_workflow_id_step_order_key','UNIQUE','workflow_id,step_order'),
    ('workflows','workflows_campaign_id_fkey','FOREIGN KEY','campaign_id'),
    ('workflows','workflows_pkey','PRIMARY KEY','id')
),
actual as (
  select
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    string_agg(kcu.column_name, ',' order by kcu.ordinal_position) as columns
  from information_schema.table_constraints tc
  left join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
   and tc.table_name = kcu.table_name
  where tc.table_schema = 'public'
    and tc.table_name in (
      'workflows','workflow_steps','workflow_delivery_outbox','campaigns','campaign_leads','integration_connections','integration_oauth_states'
    )
    and tc.constraint_type in ('PRIMARY KEY','UNIQUE','FOREIGN KEY')
  group by tc.table_name, tc.constraint_name, tc.constraint_type
)
select 'missing_in_actual' as diff_type, * from expected
except
select 'missing_in_actual' as diff_type, * from actual
union all
select 'unexpected_in_actual' as diff_type, * from actual
except
select 'unexpected_in_actual' as diff_type, * from expected
order by diff_type, table_name, constraint_name;

-- FK target / rule check (uses pg_constraint for cross-schema FK reliability)
with expected(table_name, constraint_name, constraint_def) as (
  values
    ('campaign_leads','campaign_leads_campaign_id_fkey','FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE'),
    ('integration_connections','integration_connections_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('integration_oauth_states','integration_oauth_states_user_id_fkey','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('workflow_steps','workflow_steps_workflow_id_fkey','FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE'),
    ('workflows','workflows_campaign_id_fkey','FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE')
),
actual as (
  select
    c.relname as table_name,
    con.conname as constraint_name,
    pg_get_constraintdef(con.oid, true) as constraint_def
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'workflows','workflow_steps','workflow_delivery_outbox','campaigns','campaign_leads','integration_connections','integration_oauth_states'
    )
    and con.contype = 'f'
)
select 'missing_in_actual' as diff_type, * from expected
except
select 'missing_in_actual' as diff_type, * from actual
union all
select 'unexpected_in_actual' as diff_type, * from actual
except
select 'unexpected_in_actual' as diff_type, * from expected
order by diff_type, table_name, constraint_name;

-- ============================================================
-- 3) Index drift
-- ============================================================

with expected(tablename, indexname) as (
  values
    ('campaign_leads','campaign_leads_pkey'),
    ('campaign_leads','campaign_leads_unique_linkedin'),
    ('campaigns','campaigns_pkey'),
    ('integration_connections','idx_integration_connections_user_provider'),
    ('integration_connections','integration_connections_pkey'),
    ('integration_connections','integration_connections_user_id_provider_key'),
    ('integration_oauth_states','idx_integration_oauth_states_user_provider'),
    ('integration_oauth_states','integration_oauth_states_pkey'),
    ('integration_oauth_states','integration_oauth_states_state_token_key'),
    ('workflow_delivery_outbox','idx_workflow_delivery_outbox_queue'),
    ('workflow_delivery_outbox','workflow_delivery_outbox_idempotency_key_key'),
    ('workflow_delivery_outbox','workflow_delivery_outbox_pkey'),
    ('workflow_steps','idx_workflow_steps_user_id'),
    ('workflow_steps','idx_workflow_steps_workflow_id'),
    ('workflow_steps','workflow_steps_pkey'),
    ('workflow_steps','workflow_steps_workflow_id_step_order_key'),
    ('workflows','idx_workflows_campaign_id'),
    ('workflows','idx_workflows_user_id'),
    ('workflows','workflows_pkey')
),
actual as (
  select tablename, indexname
  from pg_indexes
  where schemaname = 'public'
    and tablename in (
      'workflows','workflow_steps','workflow_delivery_outbox','campaigns','campaign_leads','integration_connections','integration_oauth_states'
    )
)
select 'missing_in_actual' as diff_type, * from expected
except
select 'missing_in_actual' as diff_type, * from actual
union all
select 'unexpected_in_actual' as diff_type, * from actual
except
select 'unexpected_in_actual' as diff_type, * from expected
order by diff_type, tablename, indexname;

-- ============================================================
-- 4) RLS enablement drift
-- ============================================================

with expected(table_name, rls_enabled, rls_forced) as (
  values
    ('campaign_leads', true, false),
    ('campaigns', true, false),
    ('integration_connections', true, false),
    ('integration_oauth_states', true, false),
    ('workflow_delivery_outbox', true, false),
    ('workflow_steps', true, false),
    ('workflows', true, false)
),
actual as (
  select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'workflows','workflow_steps','workflow_delivery_outbox','campaigns','campaign_leads','integration_connections','integration_oauth_states'
    )
)
select 'missing_in_actual' as diff_type, * from expected
except
select 'missing_in_actual' as diff_type, * from actual
union all
select 'unexpected_in_actual' as diff_type, * from actual
except
select 'unexpected_in_actual' as diff_type, * from expected
order by diff_type, table_name;

-- ============================================================
-- 5) Policy drift
-- ============================================================

with expected(tablename, policyname, permissive, roles, cmd, qual, with_check) as (
  values
    ('campaign_leads','Users can manage own campaign leads','PERMISSIVE','{public}','ALL','(auth.uid() = user_id)','(auth.uid() = user_id)'),
    ('campaigns','Users can manage own campaigns','PERMISSIVE','{public}','ALL','(auth.uid() = user_id)','(auth.uid() = user_id)'),
    ('integration_connections','integration_connections_select_own','PERMISSIVE','{public}','SELECT','(auth.uid() = user_id)',null),
    ('integration_oauth_states','integration_oauth_states_select_own','PERMISSIVE','{public}','SELECT','(auth.uid() = user_id)',null),
    ('workflow_delivery_outbox','Users can insert own workflow delivery outbox','PERMISSIVE','{public}','INSERT',null,'(auth.uid() = user_id)'),
    ('workflow_delivery_outbox','Users can update own workflow delivery outbox','PERMISSIVE','{public}','UPDATE','(auth.uid() = user_id)','(auth.uid() = user_id)'),
    ('workflow_delivery_outbox','Users can view own workflow delivery outbox','PERMISSIVE','{public}','SELECT','(auth.uid() = user_id)',null),
    ('workflow_steps','workflow_steps_delete_own','PERMISSIVE','{authenticated}','DELETE','(auth.uid() = user_id)',null),
    ('workflow_steps','workflow_steps_insert_own','PERMISSIVE','{authenticated}','INSERT',null,'(auth.uid() = user_id)'),
    ('workflow_steps','workflow_steps_select_own','PERMISSIVE','{authenticated}','SELECT','(auth.uid() = user_id)',null),
    ('workflow_steps','workflow_steps_update_own','PERMISSIVE','{authenticated}','UPDATE','(auth.uid() = user_id)','(auth.uid() = user_id)'),
    ('workflows','workflows_delete_own','PERMISSIVE','{authenticated}','DELETE','(auth.uid() = user_id)',null),
    ('workflows','workflows_insert_own','PERMISSIVE','{authenticated}','INSERT',null,'(auth.uid() = user_id)'),
    ('workflows','workflows_select_own','PERMISSIVE','{authenticated}','SELECT','(auth.uid() = user_id)',null),
    ('workflows','workflows_update_own','PERMISSIVE','{authenticated}','UPDATE','(auth.uid() = user_id)','(auth.uid() = user_id)')
),
actual as (
  select tablename, policyname, permissive, array_to_string(roles, ',') as roles_csv, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'workflows','workflow_steps','workflow_delivery_outbox','campaigns','campaign_leads','integration_connections','integration_oauth_states'
    )
),
actual_norm as (
  select tablename, policyname, permissive, '{' || roles_csv || '}' as roles, cmd, qual, with_check
  from actual
)
select 'missing_in_actual' as diff_type, * from expected
except
select 'missing_in_actual' as diff_type, * from actual_norm
union all
select 'unexpected_in_actual' as diff_type, * from actual_norm
except
select 'unexpected_in_actual' as diff_type, * from expected
order by diff_type, tablename, policyname;

-- ============================================================
-- 6) Outbox FK check (intentional absence in baseline)
-- ============================================================

select
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and tc.table_name = 'workflow_delivery_outbox'
order by tc.constraint_name;
