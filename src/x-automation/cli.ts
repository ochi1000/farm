import { XWorkflowRunner } from './runner.js';
import { X_ACTIONS, type XAction, type XTaskMode, type XTaskRequest } from './types.js';

export function parseXTaskArgs(argv: string[]): XTaskRequest {
  const values = parseArgs(argv);
  const action = String(values.action || '') as XAction;
  if (!X_ACTIONS.includes(action)) throw new Error(`--action must be one of: ${X_ACTIONS.join(', ')}`);
  const serial = required(values, 'serial');
  const accountId = String(values.account || 'x-lab-account');
  const mode: XTaskMode = values.commit ? 'commit' : 'dry-run';
  return {
    accountId,
    deviceId: String(values.device || serial),
    serial,
    action,
    mode,
    payload: {
      ...(values.username ? { username: String(values.username) } : {}),
      ...(values.text ? { text: String(values.text) } : {}),
      ...(values['post-url'] ? { postUrl: String(values['post-url']) } : {}),
      ...(values['post-index'] !== undefined ? { postIndex: integer(values['post-index'], 'post-index') } : {}),
      ...(values.scrolls !== undefined ? { scrolls: integer(values.scrolls, 'scrolls') } : {}),
      ...(values.limit !== undefined ? { limit: integer(values.limit, 'limit') } : {})
    },
    ...(values['approval-token'] || process.env.X_TASK_APPROVAL_TOKEN_INPUT
      ? { approvalToken: String(values['approval-token'] || process.env.X_TASK_APPROVAL_TOKEN_INPUT) }
      : {}),
    ...(values['idempotency-key'] ? { idempotencyKey: String(values['idempotency-key']) } : {}),
    closeTabAfter: Boolean(values['close-tab'])
  };
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const key = argument.slice(2);
    if (key === 'commit' || key === 'close-tab') result[key] = true;
    else {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      result[key] = value;
    }
  }
  return result;
}

export function required(values: Record<string, string | boolean>, key: string): string {
  const value = values[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${key} is required.`);
  return value.trim();
}

export function integer(value: string | boolean, name: string): number {
  const result = Number.parseInt(String(value), 10);
  if (!Number.isInteger(result)) throw new Error(`--${name} requires an integer.`);
  return result;
}

async function main(): Promise<void> {
  const request = parseXTaskArgs(process.argv.slice(2));
  const runner = new XWorkflowRunner();
  try {
    const output = await runner.execute(request);
    console.log(JSON.stringify({ ok: true, output }, null, 2));
  } finally {
    runner.close();
  }
}

const isEntryPoint = process.argv[1]?.replace(/\\/g, '/').endsWith('/x-automation/cli.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('/x-automation/cli.js');
if (isEntryPoint) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
