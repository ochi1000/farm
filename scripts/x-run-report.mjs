import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const deviceId = process.argv[2];
if (!deviceId || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) {
  throw new Error('Usage: node scripts/x-run-report.mjs <device-id>');
}

const database = new DatabaseSync(resolve('.automation', 'x-automation.db'), { readOnly: true });
const rows = database.prepare(`
  SELECT id, status, action, mode, created_at, started_at, finished_at, error, result_json
  FROM x_tasks
  WHERE device_id = ?
  ORDER BY created_at
`).all(deviceId);
const committedActions = Number(database.prepare(`
  SELECT COUNT(*) AS count
  FROM x_action_log
  WHERE task_id IN (SELECT id FROM x_tasks WHERE device_id = ?)
`).get(deviceId).count);
database.close();

const tasks = rows.map((row) => {
  let result;
  try {
    result = row.result_json ? JSON.parse(row.result_json) : undefined;
  } catch {
    result = undefined;
  }
  const startedAt = row.started_at || row.created_at;
  return {
    taskId: row.id,
    action: row.action,
    mode: row.mode,
    status: row.status,
    startedAt,
    finishedAt: row.finished_at,
    durationMs: row.finished_at ? new Date(row.finished_at).getTime() - new Date(startedAt).getTime() : null,
    error: row.error,
    loggedIn: result?.session?.loggedIn ?? null,
    screenOffMaintained: result?.screenOffMaintained ?? null,
    postCount: result?.posts?.length ?? 0,
    popupCount: result?.session?.popups?.length ?? 0,
    recoveries: result?.recoveries ?? []
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  deviceId,
  summary: {
    tasks: tasks.length,
    succeeded: tasks.filter((task) => task.status === 'succeeded').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    running: tasks.filter((task) => task.status === 'running').length,
    postsObserved: tasks.reduce((count, task) => count + task.postCount, 0),
    committedActions
  },
  tasks
};

mkdirSync('results', { recursive: true });
const timestamp = report.generatedAt.replace(/[:.]/g, '-');
const outputPath = resolve('results', `x-run-report-${deviceId}-${timestamp}.json`);
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, outputPath, report }, null, 2));
