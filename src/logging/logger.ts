import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult } from '../runner/result.js';

export function makeRunId(date = new Date()): string {
  return `run-${date.toISOString().replace(/[:.]/g, '-')}`;
}

export async function writeRunResult(run: RunResult): Promise<string> {
  await mkdir('results', { recursive: true });
  const path = join('results', `${run.runId}.json`);
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return path;
}

export function printChecks(checks: { name: string; status: string; detail: string }[]): void {
  for (const check of checks) {
    console.log(`${check.name}: ${check.status}${check.detail ? ` - ${check.detail}` : ''}`);
  }
}

export function printSummary(results: { testName: string; status: string }[], resultPath?: string): void {
  const width = Math.max(...results.map((result) => result.testName.length), 10) + 2;
  for (const result of results) {
    console.log(`${result.testName.padEnd(width)}${result.status}`);
  }
  if (resultPath) console.log(`Results: ${resultPath}`);
}

