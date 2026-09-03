#!/usr/bin/env node
//
// Installs Agent Skills into whichever agent tools a project uses.
//
// There is no format conversion here, and there should not be: Agent Skills is one open
// standard (https://agentskills.io) that ~45 clients implement. A skill folder is byte-for-
// byte the same everywhere. The only thing that differs between tools is WHERE they look,
// so placement is the entire job.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.join(HERE, '..', 'skills');
const LOCKFILE = '.skills-lock.json';

/**
 * Where each tool reads project-level skills.
 *
 * `detect` is the marker that says a project uses that tool. Detection matters more than it
 * looks: writing skills into a directory no tool reads produces a clean install and a skill
 * that never loads, which is indistinguishable from a skill that does not exist.
 */
const TARGETS = [
  { id: 'claude', dir: '.claude/skills', detect: '.claude', label: 'Claude Code' },
  { id: 'cursor', dir: '.cursor/skills', detect: '.cursor', label: 'Cursor' },
  { id: 'agents', dir: '.agents/skills', detect: '.agents', label: 'Copilot / Codex / others (.agents)' },
];

/** The shared convention, used when a project has no tool directories yet. */
const DEFAULT_TARGET = 'agents';

async function main(argv) {
  const [command, ...rest] = argv;
  const { flags, positionals } = parseArgs(rest);
  const cwd = flags.cwd ?? process.cwd();

  switch (command) {
    case 'list':
      return list();
    case 'add':
      return add(positionals, flags, cwd);
    case 'remove':
      return remove(positionals, cwd);
    case 'check':
      return check(cwd);
    case 'targets':
      return showTargets(cwd);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return usage();
    default:
      fail(`unknown command '${command}'. Try: help`);
  }
}

function usage() {
  process.stdout.write(`
portable-agent-skills — install Agent Skills into the tools a project actually uses

  skills list                     skills available in this collection
  skills targets                  agent tools detected in this project
  skills add <name...>            install skills (--all for everything)
  skills remove <name...>         remove previously installed skills
  skills check                    verify installed copies match source (exit 1 if not)

Options
  --all                           with 'add': install every skill
  --target claude,cursor,agents   install to specific tools instead of detected ones
  --cwd <path>                    operate on another directory
  --dry-run                       print what would happen, change nothing

Skills are the Agent Skills open standard (https://agentskills.io). The same folder is read
by Claude Code, Cursor, Copilot, Codex, Gemini CLI and others — only the location differs.
`);
}

/**
 * Splits flags from positional arguments.
 *
 * Note that a flag taking a value consumes the next argument. An earlier version collected
 * positionals with a `startsWith('-')` filter, which left the VALUE of `--cwd` in the list
 * and reported it as an unknown skill name.
 */
function parseArgs(args) {
  const flags = { dryRun: false, all: false };
  const positionals = [];
  const takesValue = new Set(['--target', '--cwd']);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    if (takesValue.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) fail(`${arg} needs a value`);

      flags[arg === '--cwd' ? 'cwd' : 'target'] = value;
      i += 1;
      continue;
    }

    switch (arg) {
      case '--dry-run': flags.dryRun = true; break;
      case '--all': flags.all = true; break;
      default: fail(`unknown option '${arg}'`);
    }
  }

  return { flags, positionals };
}

async function availableSkills() {
  const entries = await fs.readdir(SOURCE_ROOT, { withFileTypes: true });
  const names = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await exists(path.join(SOURCE_ROOT, entry.name, 'SKILL.md'))) names.push(entry.name);
  }

  return names.sort();
}

async function list() {
  for (const name of await availableSkills()) {
    const description = await readDescription(path.join(SOURCE_ROOT, name, 'SKILL.md'));
    process.stdout.write(`  ${name.padEnd(22)} ${firstSentence(description)}\n`);
  }
}

async function detectTargets(cwd, requested) {
  if (requested) {
    const ids = requested.split(',').map((s) => s.trim()).filter(Boolean);
    const chosen = TARGETS.filter((t) => ids.includes(t.id));
    const unknown = ids.filter((id) => !TARGETS.some((t) => t.id === id));

    if (unknown.length) fail(`unknown target(s): ${unknown.join(', ')}`);
    return chosen;
  }

  const found = [];
  for (const target of TARGETS) {
    if (await exists(path.join(cwd, target.detect))) found.push(target);
  }

  // No tool directories at all: fall back to the shared convention rather than guessing a
  // vendor, and say so.
  return found.length ? found : TARGETS.filter((t) => t.id === DEFAULT_TARGET);
}

async function showTargets(cwd) {
  const detected = await detectTargets(cwd, undefined);

  for (const target of TARGETS) {
    const active = detected.some((t) => t.id === target.id);
    process.stdout.write(`  ${active ? '*' : ' '} ${target.id.padEnd(8)} ${target.dir.padEnd(18)} ${target.label}\n`);
  }

  process.stdout.write('\n  * = will be installed to\n');
}

async function add(names, flags, cwd) {
  const available = await availableSkills();
  const wanted = flags.all ? available : names;

  if (!wanted.length) fail('name a skill, or pass --all. Try: skills list');

  const unknown = wanted.filter((n) => !available.includes(n));
  if (unknown.length) fail(`no such skill: ${unknown.join(', ')}. Try: skills list`);

  const targets = await detectTargets(cwd, flags.target);
  const installed = [];

  for (const target of targets) {
    for (const name of wanted) {
      const destination = path.join(cwd, target.dir, name);

      if (flags.dryRun) {
        process.stdout.write(`  would install ${name} -> ${path.relative(cwd, destination)}\n`);
        continue;
      }

      await copyDirectory(path.join(SOURCE_ROOT, name), destination);
      installed.push({ skill: name, target: target.id, path: path.relative(cwd, destination).split(path.sep).join('/') });
      process.stdout.write(`  installed ${name} -> ${path.relative(cwd, destination)}\n`);
    }
  }

  if (!flags.dryRun) await writeLock(cwd, installed);
}

async function remove(names, cwd) {
  if (!names.length) fail('name a skill to remove.');

  const lock = await readLock(cwd);
  const remaining = [];

  for (const entry of lock.installed) {
    if (!names.includes(entry.skill)) {
      remaining.push(entry);
      continue;
    }

    await fs.rm(path.join(cwd, entry.path), { recursive: true, force: true });
    process.stdout.write(`  removed ${entry.path}\n`);
  }

  await writeLock(cwd, remaining, { replace: true });
}

/**
 * Fails when an installed copy has drifted from source.
 *
 * Skills are copied rather than symlinked, because symlinks need developer mode on Windows
 * and confuse git. Copies drift, so something has to prove they have not.
 */
async function check(cwd) {
  const lock = await readLock(cwd);
  const problems = [];

  for (const entry of lock.installed) {
    const source = path.join(SOURCE_ROOT, entry.skill, 'SKILL.md');
    const installed = path.join(cwd, entry.path, 'SKILL.md');

    if (!(await exists(installed))) {
      problems.push(`${entry.path} is missing`);
      continue;
    }

    const [a, b] = await Promise.all([fs.readFile(source, 'utf8'), fs.readFile(installed, 'utf8')]);
    if (normalize(a) !== normalize(b)) problems.push(`${entry.path} differs from source`);
  }

  if (!lock.installed.length) {
    process.stdout.write('  nothing installed\n');
    return;
  }

  if (problems.length) {
    for (const problem of problems) process.stderr.write(`  DRIFT  ${problem}\n`);
    process.stderr.write(`\n${problems.length} installed skill(s) no longer match source. Re-run 'skills add'.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`  ${lock.installed.length} installed skill(s) match source\n`);
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────

const normalize = (text) => text.replace(/\r\n/g, '\n').trimEnd();

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(from, to) {
  await fs.mkdir(to, { recursive: true });

  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);

    if (entry.isDirectory()) await copyDirectory(source, destination);
    else await fs.copyFile(source, destination);
  }
}

async function readDescription(file) {
  const text = await fs.readFile(file, 'utf8');
  const match = text.match(/^description:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

const firstSentence = (text) => {
  const cut = text.split(/\.\s/)[0];
  return cut.length > 96 ? `${cut.slice(0, 93)}...` : cut;
};

async function readLock(cwd) {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, LOCKFILE), 'utf8'));
  } catch {
    return { installed: [] };
  }
}

async function writeLock(cwd, entries, { replace = false } = {}) {
  const lock = replace ? { installed: entries } : await readLock(cwd);

  if (!replace) {
    for (const entry of entries) {
      if (!lock.installed.some((e) => e.skill === entry.skill && e.target === entry.target)) {
        lock.installed.push(entry);
      }
    }
  }

  lock.installed.sort((a, b) => `${a.target}/${a.skill}`.localeCompare(`${b.target}/${b.skill}`));
  await fs.writeFile(path.join(cwd, LOCKFILE), `${JSON.stringify(lock, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`skills: ${message}\n`);
  process.exitCode = 2;
  throw new ExitSignal();
}

class ExitSignal extends Error {}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof ExitSignal)) {
    process.stderr.write(`skills: ${error.message}\n`);
    process.exitCode = 2;
  }
}
