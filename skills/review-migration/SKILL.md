---
name: review-migration
description: Reviews a database schema migration for data loss, irreversibility, locking, and deploy-order hazards before it runs against real data. Use when a change adds or edits a migration, when the user asks to review a migration, schema change, or DDL, or asks whether a migration is safe to deploy, reversible, or will lock a table.
license: MIT
metadata:
  author: waqarqasim
  version: "1.0"
---

# Review a schema migration

A migration is the least reversible thing in a codebase. Application bugs are fixed by
deploying again; a dropped column is fixed from a backup, if there is one, with the outage
that implies.

Applies to EF Core, Flyway, Liquibase, Alembic, Rails, Prisma, Django, Knex and hand-written
SQL — the hazards are properties of the database, not of the tool.

## Procedure

### 1. Read what it actually does

Read the generated SQL, not the DSL, wherever the tool can show it. A DSL call and the
statement it emits are not always the same thing, and the statement is what runs.

```bash
# examples; use whatever the project's tool provides
dotnet ef migrations script <from> <to>
alembic upgrade --sql <rev>
```

Classify every statement as **additive**, **destructive**, or **rewriting**.

### 2. Data loss

Flag every one of these, with the table and column:

- `DROP TABLE`, `DROP COLUMN`
- a type change that narrows — smaller precision, shorter length, wider to narrower numeric
- `NOT NULL` added to a column that currently holds nulls
- a unique constraint added to a column that currently holds duplicates
- a `DELETE` or `UPDATE` with no `WHERE`, or with one that is broader than it looks

For each, ask two questions and answer them in the review:

1. **Is the data needed?** Not "is it used by the new code" — is it needed by anything,
   including reports, exports, an audit obligation, or a downstream consumer.
2. **What happens to rows that violate the new rule?** A `NOT NULL` or unique constraint on
   dirty data fails the migration *in the middle*, which is worse than failing at the start.

### 3. Reversibility

- Is there a down migration, and does it actually restore, or does it only reverse the
  schema and lose the data?
- A destructive change is reversible only if the data is preserved somewhere first.
- If it is genuinely irreversible, say so explicitly in the review. That is a decision to
  take deliberately, not to discover during an incident.

### 4. Deploy order — the case most often missed

The migration and the application deploy at different moments. Between them, **old code runs
against the new schema** and possibly the reverse.

Check the change survives both orders:

- Migration first, old code still running: does the old code break? Adding a `NOT NULL`
  column with no default breaks every insert the old code performs.
- New code first, migration not yet applied: does the new code break?

Where a change cannot survive both, it must be split — expand, migrate, contract:

1. add the new column, nullable, and write to both
2. backfill
3. switch reads
4. drop the old column, **in a later release**

If the migration does the whole thing at once, that is the finding.

### 5. Locking and duration

On a large table, ask what the statement locks and for how long:

- adding a column with a **volatile** default rewrites the table on many engines
- adding an index without the concurrent option locks writes for the build
- changing a column type usually rewrites
- a foreign key addition scans the referenced table

State the risk in terms of the actual table size where you can find it. "Locks `orders`,
which has 40M rows" is actionable; "may be slow" is not.

### 6. Correctness details

- **Idempotency** — will re-running it fail? Migrations get re-run after partial failures.
- **Transactionality** — some statements cannot run inside a transaction (`CREATE INDEX
  CONCURRENTLY`, `CREATE DATABASE`). Mixing them with transactional DDL leaves a half-applied
  migration.
- **Naming** — identifiers longer than the engine's limit are silently truncated, and two
  truncated names can collide.
- **Ordering** — does this migration assume another has run? Is that guaranteed?
- **Seed and data scripts** embedded in a migration: are they scoped correctly, and do they
  behave on an empty database *and* a full one?

### 7. Sibling code

A migration is rarely wrong on its own. Check the code that reads and writes the changed
tables was updated with it, including anything outside the main application — reports, jobs,
exports, external consumers reading the schema directly.

## Report

```markdown
## Migration review — <file/name>

**Verdict:** safe to deploy | safe with conditions | do not deploy

**Statements:** <n additive, n destructive, n rewriting>

### Blocking
| # | Issue | Table | Consequence | Fix |

### Needs a decision
| # | Issue | Why it is a judgement call |

### Deploy notes
- Order: <migration first | code first | either>
- Expected lock: <statement, table, estimated impact>
- Reversible: <yes | schema only | no>
- Backfill required: <yes/no, and where>
```

## Rules

- **Never approve a destructive statement without naming what is lost.** If you cannot
  determine whether the data is needed, that is the finding — say who must answer it.
- **Additive-only is not automatically safe.** A `NOT NULL` column with no default breaks
  old code the moment the migration lands.
- **Do not trust the migration name.** `AddOrderNotes` may also drop something; read the
  statements.
