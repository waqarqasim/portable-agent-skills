import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CLI = path.join(ROOT, 'bin', 'skills.mjs');
const LINT = path.join(ROOT, 'lint', 'lint-skills.mjs');

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-test-'));
after(() => fs.rm(scratch, { recursive: true, force: true }));

/** Runs a script and returns { code, stdout, stderr } without throwing on failure. */
function run(script, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function project(name, tools = ['.claude']) {
  const dir = path.join(scratch, name);
  for (const tool of tools) await fs.mkdir(path.join(dir, tool), { recursive: true });
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** A throwaway skill collection, so lint tests do not depend on the real skills. */
async function skillDir(name, frontmatter, body = '# Instructions\n\nDo the thing.\n') {
  const root = path.join(scratch, `lint-${name}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, name, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`);
  return root;
}

const GOOD_DESCRIPTION =
  'Does a specific useful thing to a codebase and reports what it found. '
  + 'Use when the user asks to do that thing, or mentions the thing by name.';

describe('installer', () => {
  it('installs into every detected tool', async () => {
    const dir = await project('detect-both', ['.claude', '.cursor']);

    const result = run(CLI, ['add', 'verify-change', '--cwd', dir]);

    assert.equal(result.code, 0, result.stderr);
    await assert.doesNotReject(fs.access(path.join(dir, '.claude/skills/verify-change/SKILL.md')));
    await assert.doesNotReject(fs.access(path.join(dir, '.cursor/skills/verify-change/SKILL.md')));
  });

  it('does not install into a tool the project does not use', async () => {
    const dir = await project('claude-only', ['.claude']);

    run(CLI, ['add', 'verify-change', '--cwd', dir]);

    await assert.rejects(fs.access(path.join(dir, '.cursor/skills/verify-change')));
  });

  it('falls back to the shared .agents location when no tool is present', async () => {
    const dir = await project('bare', []);

    run(CLI, ['add', 'verify-change', '--cwd', dir]);

    // Writing nowhere would be worse: a clean install and a skill nothing ever loads.
    await assert.doesNotReject(fs.access(path.join(dir, '.agents/skills/verify-change/SKILL.md')));
  });

  it('treats the value of --cwd as a path, not a skill name', async () => {
    // Regression. The first version collected positionals by filtering out anything starting
    // with '-', which left the VALUE of --cwd in the list and reported it as a bad skill.
    const dir = await project('cwd-value');

    const result = run(CLI, ['add', 'verify-change', '--cwd', dir]);

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /no such skill/);
  });

  it('refuses an unknown skill rather than installing nothing quietly', async () => {
    const dir = await project('unknown-skill');

    const result = run(CLI, ['add', 'no-such-skill', '--cwd', dir]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /no such skill/);
  });

  it('refuses an unknown option', async () => {
    const dir = await project('unknown-flag');

    const result = run(CLI, ['add', 'verify-change', '--turbo', '--cwd', dir]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /unknown option/);
  });

  it('refuses a value-taking flag with no value', async () => {
    const result = run(CLI, ['add', 'verify-change', '--cwd']);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /needs a value/);
  });

  it('changes nothing on a dry run', async () => {
    const dir = await project('dry');

    const result = run(CLI, ['add', '--all', '--dry-run', '--cwd', dir]);

    assert.match(result.stdout, /would install/);
    await assert.rejects(fs.access(path.join(dir, '.claude/skills')));
  });

  it('removes what it installed', async () => {
    const dir = await project('removal');
    run(CLI, ['add', 'verify-change', 'qa-test-plan', '--cwd', dir]);

    run(CLI, ['remove', 'qa-test-plan', '--cwd', dir]);

    await assert.rejects(fs.access(path.join(dir, '.claude/skills/qa-test-plan')));
    await assert.doesNotReject(fs.access(path.join(dir, '.claude/skills/verify-change')));
  });
});

describe('check', () => {
  it('passes when installed copies match source', async () => {
    const dir = await project('check-clean');
    run(CLI, ['add', 'verify-change', '--cwd', dir]);

    assert.equal(run(CLI, ['check', '--cwd', dir]).code, 0);
  });

  it('fails when an installed copy has been edited', async () => {
    // Skills are copied, not symlinked, because symlinks need developer mode on Windows.
    // Copies drift, so something has to prove they have not.
    const dir = await project('check-drift');
    run(CLI, ['add', 'verify-change', '--cwd', dir]);
    await fs.appendFile(path.join(dir, '.claude/skills/verify-change/SKILL.md'), '\nedited\n');

    const result = run(CLI, ['check', '--cwd', dir]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /differs from source/);
  });

  it('fails when an installed skill has been deleted', async () => {
    const dir = await project('check-missing');
    run(CLI, ['add', 'verify-change', '--cwd', dir]);
    await fs.rm(path.join(dir, '.claude/skills/verify-change'), { recursive: true });

    assert.equal(run(CLI, ['check', '--cwd', dir]).code, 1);
  });
});

describe('lint — specification rules', () => {
  it('accepts a valid skill', async () => {
    const root = await skillDir('good-skill', `name: good-skill\ndescription: ${GOOD_DESCRIPTION}`);

    assert.equal(run(LINT, [root]).code, 0);
  });

  it('rejects a missing name', async () => {
    const root = await skillDir('no-name', `description: ${GOOD_DESCRIPTION}`);

    assert.match(run(LINT, [root]).stderr, /missing required field: name/);
  });

  it('rejects a name that does not match its directory', async () => {
    // The skill would install under one name and be invoked under another.
    const root = await skillDir('dir-name', `name: other-name\ndescription: ${GOOD_DESCRIPTION}`);

    assert.match(run(LINT, [root]).stderr, /does not match its directory/);
  });

  it('rejects illegal characters in a name', async () => {
    const root = await skillDir('Bad_Name', `name: Bad_Name\ndescription: ${GOOD_DESCRIPTION}`);

    assert.match(run(LINT, [root]).stderr, /only a-z, 0-9 and hyphens/);
  });

  it('rejects consecutive hyphens in a name', async () => {
    const root = await skillDir('bad--name', `name: bad--name\ndescription: ${GOOD_DESCRIPTION}`);

    assert.match(run(LINT, [root]).stderr, /consecutive hyphens/);
  });

  it('rejects a missing description', async () => {
    const root = await skillDir('no-description', 'name: no-description');

    assert.match(run(LINT, [root]).stderr, /missing required field: description/);
  });

  it('rejects a description over the specification limit', async () => {
    const root = await skillDir('too-long', `name: too-long\ndescription: Use when ${'x'.repeat(1100)}`);

    assert.match(run(LINT, [root]).stderr, /max 1024/);
  });

  it('rejects frontmatter that is absent entirely', async () => {
    const root = path.join(scratch, `raw-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(path.join(root, 'no-frontmatter'), { recursive: true });
    await fs.writeFile(path.join(root, 'no-frontmatter', 'SKILL.md'), '# Just markdown\n');

    assert.match(run(LINT, [root]).stderr, /no YAML frontmatter/);
  });
});

describe('lint — quality rules the specification leaves open', () => {
  it('rejects a description that never says when to use the skill', async () => {
    // The rule that matters most. Agents select a skill from its description alone, so one
    // that only says what it does is never activated — it lints clean against the spec and
    // never runs, which is indistinguishable from not existing.
    const root = await skillDir(
      'silent-trigger',
      'name: silent-trigger\ndescription: Analyses source files and produces a detailed report of what it discovered.',
    );

    const result = run(LINT, [root]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /never says WHEN/);
  });

  it('rejects a SKILL.md beyond the portable character limit', async () => {
    const root = await skillDir(
      'enormous',
      `name: enormous\ndescription: ${GOOD_DESCRIPTION}`,
      `# Instructions\n\n${'word '.repeat(3000)}`,
    );

    assert.match(run(LINT, [root]).stderr, /truncate past it/);
  });

  it('rejects a relative link that does not resolve', async () => {
    const root = await skillDir(
      'broken-link',
      `name: broken-link\ndescription: ${GOOD_DESCRIPTION}`,
      '# Instructions\n\nSee [the reference](references/MISSING.md).\n',
    );

    assert.match(run(LINT, [root]).stderr, /does not resolve/);
  });

  it('fails when there are no skills to check at all', async () => {
    // Zero skills checked reports identically to every skill passing.
    const root = path.join(scratch, `empty-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(root, { recursive: true });

    const result = run(LINT, [root]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /Nothing was checked/);
  });
});

describe('the shipped skills', () => {
  it('all pass lint', () => {
    assert.equal(run(LINT).code, 0);
  });

  it('are all installable', async () => {
    const dir = await project('install-all', ['.claude']);

    const result = run(CLI, ['add', '--all', '--cwd', dir]);

    assert.equal(result.code, 0, result.stderr);
    const installed = await fs.readdir(path.join(dir, '.claude/skills'));
    assert.ok(installed.length >= 5, `expected at least 5 skills, got ${installed.length}`);
  });
});
