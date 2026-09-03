#!/usr/bin/env node
//
// Validates skills against the Agent Skills specification, and against a quality bar the
// specification deliberately leaves open.
//
// The spec rules (name shape, length caps, required fields) come from
// https://agentskills.io/specification and are mechanical.
//
// The quality rules exist because of how skills are actually selected. Agents load only the
// name and description at startup and choose from those alone — so a skill whose description
// does not say WHEN to use it is never activated. It installs cleanly, it lints clean
// against the spec, and it never runs. That is indistinguishable from a skill that does not
// exist, and nothing reports it.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(HERE, '..', 'skills');

// From the specification.
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;

// Recommendations, enforced here because "recommended" text does not stop anyone.
const BODY_MAX_LINES = 500;

// Some agent tools cap instruction files at exactly this and truncate silently past it.
// Documented for Antigravity rules and workflow files; applied to every skill so a skill
// stays portable to the strictest host rather than to the most permissive one.
const PORTABLE_CHAR_LIMIT = 12_000;

// A description is what makes a skill fire. These are the words that signal "when".
const TRIGGER_HINTS = ['use when', 'use this when', 'when the user', 'when you', 'triggers on'];

const problems = [];
const warnings = [];

const error = (skill, message) => problems.push(`${skill}: ${message}`);
const warn = (skill, message) => warnings.push(`${skill}: ${message}`);

async function main() {
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  const directories = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (!directories.length) {
    // Zero skills checked reports identically to every skill passing.
    process.stderr.write(`lint: no skill directories found under ${SKILLS_ROOT}. Nothing was checked.\n`);
    process.exit(2);
  }

  for (const directory of directories.sort()) {
    await lintSkill(directory);
  }

  report(directories.length);
}

async function lintSkill(directory) {
  const skillFile = path.join(SKILLS_ROOT, directory, 'SKILL.md');

  let raw;
  try {
    raw = await fs.readFile(skillFile, 'utf8');
  } catch {
    error(directory, 'has no SKILL.md');
    return;
  }

  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    error(directory, 'SKILL.md has no YAML frontmatter between --- markers');
    return;
  }

  const { fields, body } = parsed;

  checkName(directory, fields.name);
  checkDescription(directory, fields.description);
  checkOptionalFields(directory, fields);
  checkBody(directory, body, raw);
  await checkReferences(directory, body);
}

function checkName(directory, name) {
  if (!name) {
    error(directory, 'frontmatter is missing required field: name');
    return;
  }

  if (name !== directory) {
    // The spec requires these to match; a mismatch means the skill installs under one name
    // and is invoked under another.
    error(directory, `name '${name}' does not match its directory name`);
  }

  if (name.length > NAME_MAX) error(directory, `name is ${name.length} characters (max ${NAME_MAX})`);
  if (!/^[a-z0-9-]+$/.test(name)) error(directory, `name '${name}' may contain only a-z, 0-9 and hyphens`);
  if (name.startsWith('-') || name.endsWith('-')) error(directory, `name '${name}' must not start or end with a hyphen`);
  if (name.includes('--')) error(directory, `name '${name}' must not contain consecutive hyphens`);
}

function checkDescription(directory, description) {
  if (!description) {
    error(directory, 'frontmatter is missing required field: description');
    return;
  }

  if (description.length > DESCRIPTION_MAX) {
    error(directory, `description is ${description.length} characters (max ${DESCRIPTION_MAX})`);
  }

  // The quality bar. An agent chooses a skill from its description alone.
  const lower = description.toLowerCase();

  if (!TRIGGER_HINTS.some((hint) => lower.includes(hint))) {
    error(
      directory,
      'description never says WHEN to use the skill. Agents select from the description alone, '
      + 'so one that only says what the skill does will not be activated. Add a "Use when ..." clause.',
    );
  }

  if (description.length < 80) {
    warn(directory, `description is only ${description.length} characters — likely too vague to match a task`);
  }

  const firstWord = description.trim().split(/\s+/)[0].toLowerCase();
  if (['helps', 'this', 'a', 'the'].includes(firstWord)) {
    warn(directory, `description starts with '${firstWord}' — start with the verb the skill performs`);
  }
}

function checkOptionalFields(directory, fields) {
  if (fields.compatibility && fields.compatibility.length > COMPATIBILITY_MAX) {
    error(directory, `compatibility is ${fields.compatibility.length} characters (max ${COMPATIBILITY_MAX})`);
  }
}

function checkBody(directory, body, raw) {
  if (!body.trim()) {
    error(directory, 'SKILL.md has frontmatter but no instructions');
    return;
  }

  const lines = body.split('\n').length;
  if (lines > BODY_MAX_LINES) {
    warn(directory, `body is ${lines} lines (spec recommends under ${BODY_MAX_LINES}) — move detail into references/`);
  }

  if (raw.length > PORTABLE_CHAR_LIMIT) {
    error(
      directory,
      `SKILL.md is ${raw.length} characters. Some hosts cap instruction files at ${PORTABLE_CHAR_LIMIT} `
      + 'and truncate past it without saying so. Move detail into references/.',
    );
  }
}

/** Relative links must resolve, or the agent follows them to nothing at run time. */
async function checkReferences(directory, body) {
  const links = [...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);

  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;

    const target = path.join(SKILLS_ROOT, directory, link.split('#')[0]);
    try {
      await fs.access(target);
    } catch {
      error(directory, `relative link '${link}' does not resolve`);
    }
  }
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const fields = {};
  let currentKey = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s/.test(line) && currentKey) continue;          // nested mapping value

    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;

    currentKey = kv[1];
    fields[currentKey] = kv[2].replace(/^["']|["']$/g, '').trim();
  }

  return { fields, body: match[2] };
}

function report(checked) {
  for (const warning of warnings) process.stdout.write(`  warn   ${warning}\n`);
  for (const problem of problems) process.stderr.write(`  ERROR  ${problem}\n`);

  process.stdout.write(`\n  checked ${checked} skill(s): ${problems.length} error(s), ${warnings.length} warning(s)\n`);

  if (problems.length) process.exit(1);
}

await main();
