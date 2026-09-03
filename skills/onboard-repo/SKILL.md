---
name: onboard-repo
description: Builds an accurate working model of an unfamiliar codebase from evidence rather than assumption, then writes or refreshes an AGENTS.md so later sessions and other agents start informed. Use when opening a repository for the first time, when the user asks how a codebase works, how to build or run it, where something lives, or asks to create, update or improve AGENTS.md, CLAUDE.md or contributor documentation.
license: MIT
metadata:
  author: waqarqasim
  version: "1.0"
---

# Onboard onto a repository

The failure mode when landing in unfamiliar code is not being unable to find things. It is
forming a confident, wrong model early and then interpreting everything else through it.

Work from evidence, and record which parts are verified.

## Procedure

### 1. Shape before detail

Establish size and structure before reading any implementation. Reading files at random in a
large repository produces a model built from whatever you happened to open.

```bash
git log --oneline -1 && git log --since='90 days ago' --oneline | wc -l   # is it alive?
```

Find: the number of projects/packages, the entry points, the test projects, and the
directories that hold most of the code. Note the top-level layout and what each part is for.

### 2. Read what the repository already says

In this order, because later sources are usually staler:

1. `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`
2. `README.md`, `CONTRIBUTING.md`
3. `docs/`, architecture decision records
4. CI workflows — **the most reliable source in the repository**

CI is honest in a way documentation is not: it is executable, and it fails when it is wrong.
The build, test and lint commands in CI are the real ones, whatever the README says.

### 3. Establish the commands, by running them

Do not transcribe commands from a README. Run them.

- build
- test
- lint / format
- run locally

Record what actually worked, including flags and prerequisites the docs omitted. If
something failed, record that too — a documented command that does not work is a finding,
and the next person hits it in ten minutes.

### 4. Find the conventions from the code

Read three or four files that do the same kind of thing and note what they share: layering,
naming, error handling, how data access is done, how tests are structured, how features are
registered.

Where the codebase is inconsistent, say which pattern is the current one — usually the one
in the most recently changed files:

```bash
git log --since='60 days ago' --name-only --pretty=format: | sort | uniq -c | sort -rn | head -30
```

The most-changed files are where the work happens, and they teach more than the oldest ones.

### 5. Find the rules that are enforced

Anything the repository enforces mechanically is a hard constraint, not a preference:
architecture tests, analyzers, `TreatWarningsAsErrors`, commit hooks, required checks.

These matter more than any written style guide, because they will stop your change.

### 6. Identify what you do not know

Explicitly list the parts you did not verify: areas you did not read, commands you could not
run, claims from the docs you could not confirm. This list is the most useful part of the
output — it stops the next reader treating a guess as established.

## Writing AGENTS.md

Write to the repository root. If one exists, **update it rather than replacing it** — it may
contain decisions you cannot re-derive.

Include only what a competent newcomer cannot work out in thirty seconds:

- what the project is, in two lines
- the layout, and what each part is for
- **the exact build, test and run commands** that you ran
- conventions that differ from the language's defaults
- mechanically enforced rules, and where they live
- known traps — the things that waste an afternoon
- what is out of bounds: generated directories, vendored code, legacy areas

Leave out anything obvious from looking, anything already in the README, and anything you
did not verify. A guide that is half guesses is worse than none, because it is trusted.

**Keep each file under 12,000 characters.** Some agent tools impose exactly that limit on
instruction files and truncate or reject beyond it — silently. In a large repository, prefer
a short root file that points at per-area files over one long one.

Close with the date and what was verified:

```markdown
<!-- Verified 2026-09-03: build, test and lint commands run clean. Deployment and the
     reporting module were not exercised. -->
```

## Rules

- **Never state a command you have not run.** Mark it unverified instead.
- **CI beats the README.** Where they disagree, CI is what is true.
- **Record the traps.** The thing that cost you twenty minutes will cost everyone else
  twenty minutes.
- **Say what you did not check.** Confidence with no coverage is the failure this skill
  exists to prevent.
