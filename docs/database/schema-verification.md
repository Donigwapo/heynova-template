# Phase 2A.1 Schema Verification

## Purpose

Detect drift between environments (production/staging/development/local) for the scoped workflow/campaign/integration schema.

## Verification SQL

- `supabase/sql/phase2a1_schema_verification_queries.sql`

The verification script checks:

1. Columns, types, defaults, nullability
2. PK/UNIQUE/FK constraints
3. FK targets and delete/update rules
4. Index names/presence
5. RLS enablement flags
6. Policy names/roles/commands/expressions
7. Explicit check that `workflow_delivery_outbox` has no FK constraints

## How to run

Against linked (remote) environment:

```bash
supabase db query --linked -f supabase/sql/phase2a1_schema_verification_queries.sql
```

Against local environment:

```bash
supabase db query --local -f supabase/sql/phase2a1_schema_verification_queries.sql
```

## How to interpret results

- Drift sections return rows with `diff_type`:
  - `missing_in_actual` = expected by baseline but missing in environment
  - `unexpected_in_actual` = present in environment but not in baseline expectation
- A clean match returns **no rows** in drift sections.
- The final outbox FK query should return **zero rows** under current baseline reality.

## Important caveat

`CREATE ... IF NOT EXISTS` is **not** used as drift detection in verification.
Drift detection is metadata-driven via `information_schema` / `pg_catalog` comparisons.
