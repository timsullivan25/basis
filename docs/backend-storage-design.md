# Backend storage design — intended direction

Status: **design agreed, not yet implemented.** Written 2026-09-12 as a reference for when this
feature is built; check it against the current code first, since the plan will predate the build.

## Why this exists

Today all persistence is local-only IndexedDB (`apps/shell/src/data/`, single-user, no network
calls). The product is becoming a multi-user SaaS app, single-tenant per deployment (one Postgres
instance per customer, no shared-tenant infrastructure needed). This doc captures the agreed shape
of the backend that migration moves toward.

## Requirements this is designed against

- Single tenant per deployment — no `org_id` / row-level tenancy needed anywhere.
- Multiple users per deployment, each with their own settings and **coverage** (a filtered list of
  companies they follow).
- Models and other content track who created them.
- No real-time concurrent editing of the same model — at most one active editor at a time.
- Cross-model features (e.g. comparing companies) only ever read the **latest published snapshot**,
  never in-progress edits.
- In-progress work should sync to the cloud so a session is never lost, but expensive computed
  values don't need to live centrally except for what's been published.

## Decision: Postgres only, relational core + JSONB for frozen/array payloads

No separate NoSQL store. One database, two shapes of column, chosen per field:

- **Real FK'd rows** for anything the app needs to look up, filter, or enforce integrity on:
  `users`, `companies`, `user_coverage`, `statement_schemas`, `model_imports`, `mappings`,
  `models`, `scenarios`, `line_instances`, `snapshots`.
- **JSONB columns on those rows** for array-indexed or frozen-copy fields nothing ever queries
  *into* — `Model.historicals` / `driverValues`, `Scenario.driverValues`, `Snapshot.schema` /
  `mapping` / `scenarios` / `instances`. Normalizing these would add join cost with no query
  benefit; they're always read/written whole, by parent id.

### Sketch

```
users             (id, email, name, ...)
user_coverage     (user_id, company_id)              -- per-user watchlist
companies         (id, name, created_at)              -- the covered/analyzed entity (NOT tenant)
statement_schemas (id, name, sections JSONB, drivers JSONB, created_by, created_at, updated_at)
model_imports     (id, company_id, created_by, file_key -> object storage, uploaded_at, ...)
mappings          (id, model_import_id, statement_schema_id, lines JSONB, mapped_at)
models            (id, company_id, created_by, statement_schema_id, model_import_id, mapping_id,
                   timeline JSONB, historicals JSONB, driver_values JSONB,
                   instances_updated_at, updated_at, version)
scenarios         (id, model_id, driver_values JSONB, updated_at)
line_instances    (id, model_id, line_id, section_id, name, source_line_ids JSONB,
                   projection JSONB, created_at, updated_at)   -- small enough to be real rows
snapshots         (id, model_id, company_id, created_by, label, note,
                   timeline JSONB, historicals JSONB, schema JSONB, mapping JSONB,
                   scenarios JSONB, instances JSONB, source_file_name, source_uploaded_at,
                   is_latest BOOLEAN, created_at)
```

`Company` here keeps its current meaning — a covered/analyzed entity (issuer, portfolio company) —
**not** the tenant. Since deployment is single-tenant, no separate organization table is needed;
`users` and `user_coverage` are the only identity/access additions to today's schema.

Raw uploaded files (`ModelImport.file`, currently a Blob in IndexedDB) move to object storage
(S3-compatible); Postgres holds only the key.

## Decision: no sync engine — write-through autosave instead

Because at most one user edits a given model at a time, a full local-first/CRDT sync layer is
unnecessary complexity. Instead:

- **Draft state** (in-progress `Model` / `Scenario` / `LineInstance` edits): the client keeps
  working state locally for responsive editing, and **autosaves** to Postgres on a debounce
  (periodically, and on blur/navigation). This alone satisfies "don't lose progress between
  sessions."
- **Concurrency control**: optimistic — check `updated_at` / `version` on write, reject with a
  conflict error rather than merging. No operational transforms, no CRDTs.
- **Computed values** (`ComputedResult`, `AnalysisResult`): stay ephemeral, computed locally or
  on-demand per session for a model still being edited. Never persisted centrally while in draft —
  cheap to recompute, per the existing version-stamp design in `apps/shell/src/data/types.ts`.
- **Published state**: publishing creates a `Snapshot`, and that's the one write where computed
  values *are* persisted centrally — `SnapshotScenario.values` / `errors` already does this in the
  current data model. No new concept needed here, just moving the existing shape server-side.

## Deferred: cross-model comparison query path

Start simple, upgrade only if performance requires it:

1. **First cut**: query `snapshots where is_latest = true and company_id in (...)`, pull the JSONB,
   extract fields in application code. Fine at low-hundreds-of-companies scale per user.
2. **If comparison views need DB-level filtering/sorting/aggregation across many companies**: add a
   companion `snapshot_metrics` table — one row per `(snapshot_id, metric_key, value)`, populated at
   publish time alongside the JSONB blob. Keeps `snapshots` as the immutable frozen record while
   giving the comparison feature indexed, queryable numbers.

Decide between these based on actual comparison-feature requirements when that phase is designed,
not preemptively.

## Migration path

`apps/shell/src/data/index.ts` already isolates every consumer behind repository interfaces
(`ModelRepository`, `CompanyRepository`, etc.) — see its own comment: swapping to a real backend is
a new class implementing the same interface, plus a change in that one file. The interfaces in
`apps/shell/src/data/types.ts` should need little to no change; only the concrete
`IndexedDb*Repository` implementations get replaced with API-backed ones.

## Explicitly out of scope

- Real-time collaborative editing of a single model (no CRDT/OT).
- Multi-tenant infrastructure (shared instance serving multiple customer orgs, `org_id` /
  row-level security). Revisit only if the single-tenant-per-deployment assumption changes.
