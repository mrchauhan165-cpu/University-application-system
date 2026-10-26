#!/usr/bin/env node
/**
 * CI helper: turn the tail of a failed test log into GitHub annotations.
 *
 * Without this, a failing `npm test` shows up only as "Process completed with
 * exit code 1" — and the raw log is not always reachable. Annotations are
 * readable from the run page, the pull request and the REST API.
 */
import { readFileSync, existsSync } from 'node:fs';

const file = process.argv[2] ?? 'vitest.log';
if (!existsSync(file)) {
  console.log('::error::Test log missing — the test command did not produce output.');
  process.exit(0);
}

const raw = readFileSync(file, 'utf8');
const lines = raw.split(/\r?\n/);

const escape = (value) =>
  value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');

// Prefer the lines that describe the failure; fall back to the tail.
const interesting = lines.filter((line) =>
  /(FAIL|✕|×|AssertionError|Error:|Test Files|Tests\s+\d|Unhandled|Cannot find|is not a function|expected)/i.test(line),
);
const summary = (interesting.length ? interesting : lines).slice(-40);

for (const line of summary) {
  const text = line.trim();
  if (!text) continue;
  console.log(`::error::${escape(text.slice(0, 900))}`);
}

// Also keep the full tail in the log for anyone who can open it.
console.log('\n--- last 40 lines ---');
console.log(lines.slice(-40).join('\n'));
