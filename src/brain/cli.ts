import { randomUUID } from 'node:crypto';
import { parseArgs, required } from '../x-automation/cli.js';
import { XWorkflowRunner } from '../x-automation/runner.js';
import { OllamaBrain, planPayload } from './ollama.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.commit) throw new Error('Use the reviewed X action workflow to commit a prepared draft.');
  const runner = new XWorkflowRunner();
  const context = { serial: required(args, 'serial'), deviceId: required(args, 'device'), accountId: String(args.account || 'x-lab-account') };
  try {
    const observed = await runner.execute({ ...context, action: 'read_feed', mode: 'dry-run', payload: { limit: 10 }, closeTabAfter: true });
    const plan = await new OllamaBrain().plan(required(args, 'instruction'), observed.posts);
    if (plan.action === 'clarify') { console.log(JSON.stringify({ plan })); return; }
    const output = await runner.execute({ ...context, action: plan.action, payload: planPayload(plan), mode: 'dry-run', idempotencyKey: randomUUID(), closeTabAfter: true });
    console.log(JSON.stringify({ plan, taskId: output.taskId, result: output.actionResult, postCount: output.posts?.length, screenOffMaintained: output.screenOffMaintained }));
  } finally { runner.close(); }
}
main().catch(() => { console.error('Brain workflow failed; inspect local workflow audit. No automatic retry was made.'); process.exitCode = 1; });
