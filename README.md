# portable-agent-skills

[![ci](https://github.com/waqarqasim/portable-agent-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/waqarqasim/portable-agent-skills/actions/workflows/ci.yml)

Five [Agent Skills](https://agentskills.io) that work in Claude Code, Cursor, GitHub
Copilot, Codex, Gemini CLI and ~40 other clients — plus an installer that puts them where
each tool actually looks.

```bash
npx portable-agent-skills add qa-test-plan
npx portable-agent-skills add --all
npx portable-agent-skills check      # CI: fails if an installed copy drifted from source
```

---

## There is no format conversion here, and there should not be

Agent Skills is one open standard. A skill is a folder with a `SKILL.md` carrying `name` and
`description` frontmatter, and **the same folder is read byte-for-byte by every client that
implements it.** The format was released by Anthropic as an open standard and adopted across
the ecosystem.

The only thing that differs between tools is *where they look*:

| Tool | Project-level location |
| --- | --- |
| Claude Code | `.claude/skills/<name>/SKILL.md` |
| Cursor | `.cursor/skills/<name>/SKILL.md` |
| Copilot, Codex, others | `.agents/skills/<name>/SKILL.md` |

So placement is the entire job, and the installer is deliberately thin. It detects which of
those directories a project has, copies the skill into each, and records a lockfile so
`remove` and `check` work later. If a project has none of them it falls back to `.agents/`
and says so — writing nowhere would produce a clean install and a skill that never loads.

## The skills

| | What it does |
| --- | --- |
| **`qa-test-plan`** | Writes a granular manual QA plan for a specific PR or commit: exact click paths, exact input values, exact expected results, with negative cases derived from the code's real validation rather than invented |
| **`verify-change`** | Proves a change is real by breaking it on purpose and confirming a test goes red |
| **`audit-test-doubles`** | Finds tests that pass whether or not the production code is correct |
| **`review-migration`** | Reviews a schema migration for data loss, irreversibility, locking and deploy-order hazards |
| **`onboard-repo`** | Builds an accurate model of an unfamiliar codebase from evidence, then writes or refreshes `AGENTS.md` |

Each was chosen because it addresses a failure that is common, expensive, and invisible
while it is happening.

### `qa-test-plan` is the one to read first

Most generated test plans fail identically: *"Verify the order saves correctly."* A tester
cannot execute that and cannot tell you whether it passed. The skill forces every case to
answer three questions on its face — where do I start, what exactly do I do, and how would I
know it failed — and derives negative cases from guards that actually exist in the diff,
citing each one. A guard with no reachable case is reported as a gap, which is usually worth
more than another test case.

## The linter is the part with teeth

`npm run lint` checks the [specification's rules](https://agentskills.io/specification) —
name shape and length, description length, required fields, matching directory name. Those
are mechanical.

It also checks three things the spec leaves open, each of which fails silently otherwise:

**1. A description that never says *when*.** Agents load only the name and description at
startup and select a skill from those alone. A description that says what the skill does but
not when to use it is never activated. It installs cleanly, passes spec validation, and
never runs — which is indistinguishable from a skill that does not exist, and nothing
reports it. This is the highest-value rule in the file.

**2. A `SKILL.md` over 12,000 characters.** Some hosts cap instruction files at exactly that
and truncate past it without saying so — it is documented for Antigravity's rules and
workflow files. Enforced against every skill, so a skill stays portable to the strictest
host rather than the most permissive one.

**3. Relative links that do not resolve.** The agent follows them at run time to nothing.

And it exits non-zero when there are **no skills to check at all**, because zero skills
passing reports identically to every skill passing.

## Verified, not asserted

26 tests, run with Node's built-in runner, no dependencies. The rules that carry the design
were mutation-checked rather than trusted:

| mutation | result |
| --- | --- |
| drop the "description must say when" rule | 1 test fails |
| stop enforcing the 12,000-character limit | 1 test fails |
| installer writes nowhere when no tool is detected | 1 test fails |

One test is a regression test for a bug found while building: the first argument parser
collected positionals by filtering out anything starting with `-`, which left the *value* of
`--cwd` in the list and reported the user's own path as an unknown skill name.

## Layout

```
skills/<name>/SKILL.md    the skills — the actual product
bin/skills.mjs            the installer, zero dependencies
lint/lint-skills.mjs      spec validation plus the quality rules
tests/cli.test.mjs        26 tests
```

## Using a skill

Install it, then invoke it by name — `/qa-test-plan` in Claude Code, or just describe the
task and let the agent select it from the description. That selection is why the linter is
strict about descriptions.

Skills are also picked up from `~/.claude/skills/` (Claude Code) for use across all your
projects, rather than per repository.

## Requirements

Node 20 or newer, for the installer only. The skills themselves are markdown and need
nothing.

## Licence

MIT. Take any of it — including a single `skills/<name>/` folder, which is self-contained.
