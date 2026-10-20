# Phase 2A.1 Schema Baseline (Workflow/Campaign/Integration)

## Purpose

This baseline captures the **current production reality** for the following tables:

- `public.workflows`
- `public.workflow_steps`
- `public.workflow_delivery_outbox`
- `public.campaigns`
- `public.campaign_leads`
- `public.integration_connections`
- `public.integration_oauth_states`

This is **not** a schema redesign or hardening pass.

## Baseline migration file

- `supabase/migrations/20260918224000_phase2a1_workflow_campaign_integration_schema_baseline.sql`

## Safety / intent

- Do **not** treat this as a migration to run against already-existing production where these objects already exist.
- This file establishes repository schema history so fresh environments can reproduce known objects.
- Architectural imperfections intentionally remain preserved when present in production.
  - Example: `workflow_delivery_outbox` has no foreign keys in current production baseline scope.

## Ownership model in current baseline

Current schema ownership boundary is `user_id` (not `tenant_id` / `organization_id`).

No synthetic tenant model is introduced in this phase.

## Objects represented

For scoped tables, the baseline includes:

- table definitions
- defaults
- nullability
- primary keys
- foreign keys
- unique constraints
- indexes
- RLS enablement
- RLS policies

## Dependencies represented

- `auth.users(id)` FK dependency is included for:
  - `integration_connections.user_id`
  - `integration_oauth_states.user_id`

## Notes for future phases

Forward migrations (Phase 2+) may improve constraints/policies/indexes/execution schema.
Those changes must be explicit, additive migrations after this baseline checkpoint.
