---
name: verify-change
description: Proves a change is real by breaking it on purpose and confirming a test goes red, instead of reading the diff and declaring it correct. Use after making a fix or adding a feature, when the user asks to verify, confirm, prove, or double-check that a change works, or when tests pass and you want to know whether they were actually watching.
license: MIT
metadata:
  author: waqarqasim
  version: "1.0"
---

# Verify a change by mutating it

Reading your own change confirms your intent. It cannot confirm the change is wired to
anything, and it cannot confirm any test is watching it.

A passing suite after a change proves the suite still passes. It does not prove the suite
would have failed without the change — and those are different facts.

## Procedure

### 1. Confirm green, and confirm what ran

Run the tests. Note **how many ran**, not only that they passed.

Zero tests passing out of zero renders identically to success, and a filter, a wrong path,
or a project that did not build produces exactly that. If the count looks low, find out why
before continuing.

### 2. Break the change on purpose

Pick the smallest mutation that makes the change wrong while still compiling:

- invert the condition you added
- delete the guard clause
- return the wrong branch
- change a passed argument to the wrong one
- make the new matcher never match

**The mutation must compile.** If it does not, the test run afterwards is not a result — it
is the previous binary, and it will report green while proving nothing.

### 3. Run again and read what turned red

- **Something failed** — name the exact tests. That is the evidence the change is real and
  watched.
- **Nothing failed** — the test was never watching this behaviour. This is the finding. Do
  not restore and move on; fix the test first, then repeat from step 1.

### 4. Restore, and confirm green again

Verify the restoration actually happened — a mutation left behind is worse than no
verification at all.

### 5. Mutate both directions where a baseline exists

For anything with an approved list, a snapshot, or a baseline file, also **remove a known
entry** and confirm the check notices it disappeared. A check that only notices new problems
lets its allowance grow forever, and a fixed defect leaves behind permission for the same
defect to return.

## Report

State plainly:

- what was mutated, and where
- which tests turned red, by name
- what is verified as a result
- **what is not** — the parts of the change no test covers

The last line is the valuable one. "Tests pass" means little; "the null-branch is covered by
`OrderTests.RejectsMissingCustomer`, the retry path is covered by nothing" is a fact someone
can act on.

## Rules

- **Never report success from reading.** If you did not watch something turn red, you did
  not verify it.
- **A stale artefact reports the old answer.** When a build fails, nothing after it is
  evidence. Check the build result before reading test output, and be suspicious of a test
  run that finishes suspiciously fast.
- **One mutation at a time.** Two at once and you cannot tell which one the test caught.
- **This applies to tooling too.** A lint rule, a schema check, an architecture test — add
  the violation it claims to catch and watch it fire. A rule that has never been observed
  failing is a rule with no evidence behind it.
