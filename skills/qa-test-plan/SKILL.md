---
name: qa-test-plan
description: Writes a granular manual QA test plan for a specific pull request, commit, or branch — exact click paths, exact input values, exact expected results, plus negative and boundary cases derived from the code's real validation. Use when the user asks for QA test cases, a test plan, a test script, manual testing steps, regression steps, UAT cases, or "what should QA check for this PR".
license: MIT
metadata:
  author: waqarqasim
  version: "1.0"
---

# QA test plan from a change

Produce a test plan a tester can execute **without reading any code**, derived from what a
specific change actually did.

## The bar

Most generated test plans fail the same way: they read as `Verify the order saves
correctly`. A tester cannot execute that, and cannot tell you whether it passed. Every case
you write must answer three questions on its face:

1. **Where do I start?** — the exact screen, route, or endpoint, and the state and role
   required to reach it.
2. **What exactly do I do?** — the exact values typed, the exact controls clicked, in order.
3. **How would I know it failed?** — an observable result. Specific text, a specific state
   change, a specific HTTP status. Not "works", not "is correct", not "as expected".

If a case cannot answer all three, it is not a test case yet. Either sharpen it or move it
to the *Cannot be tested manually* section.

## Procedure

### 1. Establish the change set

Work from the diff, never from the description. A PR title is a claim about the change; the
diff is the change.

```bash
# whichever applies
gh pr diff <number>
git diff <base>...<head>
git show <commit>
```

Then list, from the diff only:

- **User-visible surfaces touched** — pages, components, routes, endpoints, jobs, emails,
  exports, notifications.
- **Behaviour changed** — new fields, altered validation, changed defaults, new states,
  changed permissions.
- **Data changes** — migrations, seed changes, config or feature flags.
- **Nothing user-visible** — say so explicitly. A refactor with no observable change should
  produce a regression-only plan, and saying that plainly is more useful than inventing
  cases.

### 2. Read the guards before writing negative cases

This is the step that separates a real plan from a plausible one.

Open the changed code and find the **actual** validation: required fields, length and range
limits, format rules, uniqueness constraints, authorization checks, state-machine
transitions that are refused, concurrency guards.

Every negative case you write must correspond to a guard that exists in the code, and must
cite it. Invented negative cases — "try entering emoji" — waste a tester's day and prove
nothing. A guard with no case is a gap worth reporting.

Note the exact user-facing message where the code specifies one. "Shows an error" is not an
expected result; "shows *Quantity must be greater than zero*" is.

### 3. Establish preconditions honestly

For each area, state what must be true before step 1:

- **Role and permissions** — the specific role, and any permission the code checks.
- **Data state** — the records that must exist, with the field values that matter.
- **Environment** — feature flags, config, integrations that must be reachable.

If a precondition is expensive to create, say how (a seed script, an admin screen, a SQL
snippet). A test case a tester cannot set up is not executable.

### 4. Write the cases

Cover, in this order:

| Type | What it covers |
| --- | --- |
| **Positive** | The change working as intended, including each new option or path |
| **Negative** | Each guard found in step 2, exercised so it fires |
| **Boundary** | The exact edges of any limit in the code — 0, 1, max, max+1, empty, null |
| **Permission** | Each role that should and should not be able to reach it |
| **Regression** | Existing behaviour the change could plausibly have broken |

Regression cases come from asking what else touches the changed code — other callers of a
changed method, other screens using a changed component, other flows reading a changed
column. Name the reason for each one; a regression case with no stated risk is filler.

### 5. State what manual testing cannot cover

Concurrency, timing, load, retry and idempotency behaviour, and anything requiring a
simulated failure usually cannot be tested by clicking. List these explicitly as needing
automation or a developer, rather than writing a case a tester will mark "passed" without
having exercised anything.

## Output format

```markdown
# QA test plan — <PR/commit reference>

**Change summary:** <two lines: what a user can now do differently>
**Areas touched:** <screens / endpoints>
**Risk:** <low | medium | high> — <why>

## Preconditions
| # | Requirement | How to set up |
|---|---|---|
| P1 | A user with role X | Admin → Users → ... |
| P2 | An order in state Draft | Seed script `...`, or create via ... |

## Test cases

### TC-01 — <short title>
- **Type:** Positive
- **Precondition:** P1, P2
- **Steps:**
  1. Navigate to `Sales → Orders` and open order `SO-1001`.
  2. Set **Quantity** to `5`.
  3. Click **Save**.
- **Expected:** Line total shows `1,250.00 EUR`; a toast reads *Order updated*; the order
  stays in state `Draft`.
- **Covers:** `src/.../OrderEditor.razor:88`

### TC-02 — <short title>
- **Type:** Negative
- **Precondition:** P1, P2
- **Steps:**
  1. Navigate to `Sales → Orders` and open order `SO-1001`.
  2. Set **Quantity** to `0`.
  3. Click **Save**.
- **Expected:** Save is refused; the field shows *Quantity must be greater than zero*; the
  stored quantity is unchanged after reload.
- **Covers:** guard at `src/.../OrderValidator.cs:41`

## Regression checks
| # | Area | Why it is at risk |
|---|---|---|

## Not coverable by manual testing
| Behaviour | Why | Suggested approach |
|---|---|---|

## Gaps found while writing this plan
<Guards with no reachable UI path, error messages that are not specified, states that
cannot be reached. These are findings, and worth more than another test case.>
```

## Rules

- **Never invent a UI element.** If you cannot find the control in the code, say the path is
  unverified rather than guessing a menu name. A wrong click path destroys a tester's trust
  in the whole document.
- **Never write an expected result you cannot observe from the interface.** "The record is
  saved to the database" is only acceptable if the plan says how to see it.
- **Prefer fewer, sharper cases.** Twenty specific cases beat sixty vague ones, and a tester
  will actually finish twenty.
- **Report gaps.** A guard you cannot reach through the UI, or an error message the code
  leaves unspecified, is a finding. Put it in the plan.
