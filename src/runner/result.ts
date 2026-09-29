import type { PageObservation } from '../browser/types.js';

export type StepStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type TestStatus = StepStatus;

export type StepResult = {
  name: string;
  startedAt: string;
  finishedAt: string;
  status: StepStatus;
  details?: Record<string, unknown>;
  observation?: PageObservation;
  error?: string;
};

export interface TestResult {
  testName: string;
  startedAt: string;
  finishedAt: string;
  phoneState: { screen: string; chrome: string };
  steps: StepResult[];
  status: TestStatus;
  error?: string;
}

export type RunResult = {
  runId: string;
  serial: string;
  startedAt: string;
  finishedAt: string;
  results: TestResult[];
};

export function statusFromSteps(steps: StepResult[]): TestStatus {
  if (steps.some((step) => step.status === 'FAIL')) return 'FAIL';
  if (steps.some((step) => step.status === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

