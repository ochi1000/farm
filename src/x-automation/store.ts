import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { auditPayload } from './policy.js';
import type { StoredTask, XAction, XTaskOutput, XTaskRequest } from './types.js';

export class XTaskStore {
  private readonly database: DatabaseSync;

  constructor(path = process.env.X_AUTOMATION_DB || resolve('.automation', 'x-automation.db')) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS x_tasks (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        account_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        action TEXT NOT NULL,
        mode TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        result_json TEXT,
        error TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS x_action_log (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        action TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS x_action_log_account_time ON x_action_log(account_id, action, committed_at);
    `);
  }

  create(request: XTaskRequest): StoredTask {
    if (request.idempotencyKey) {
      const existing = this.database.prepare('SELECT id, status, result_json, error FROM x_tasks WHERE idempotency_key = ?').get(request.idempotencyKey) as TaskRow | undefined;
      if (existing) return rowToTask(existing, true);
    }
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO x_tasks (id, idempotency_key, account_id, device_id, action, mode, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
    `).run(id, request.idempotencyKey ?? null, request.accountId, request.deviceId, request.action, request.mode, JSON.stringify(auditPayload(request)), new Date().toISOString());
    return { id, status: 'queued', existing: false };
  }

  markRunning(id: string): void {
    this.database.prepare("UPDATE x_tasks SET status = 'running', started_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  markSucceeded(id: string, result: XTaskOutput): void {
    this.database.prepare("UPDATE x_tasks SET status = 'succeeded', finished_at = ?, result_json = ?, error = NULL WHERE id = ?")
      .run(new Date().toISOString(), JSON.stringify(result), id);
  }

  markFailed(id: string, error: string): void {
    this.database.prepare("UPDATE x_tasks SET status = 'failed', finished_at = ?, error = ? WHERE id = ?")
      .run(new Date().toISOString(), error.slice(0, 2_000), id);
  }

  countCommittedToday(accountId: string, action: XAction): number {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM x_action_log WHERE account_id = ? AND action = ? AND committed_at >= ?')
      .get(accountId, action, start.toISOString()) as { count: number };
    return Number(row.count);
  }

  recordCommit(taskId: string, accountId: string, action: XAction): void {
    this.database.prepare('INSERT INTO x_action_log (task_id, account_id, action, committed_at) VALUES (?, ?, ?, ?)')
      .run(taskId, accountId, action, new Date().toISOString());
  }

  close(): void {
    this.database.close();
  }
}

type TaskRow = { id: string; status: string; result_json: string | null; error: string | null };

function rowToTask(row: TaskRow, existing: boolean): StoredTask {
  return {
    id: row.id,
    status: row.status,
    ...(row.result_json ? { result: JSON.parse(row.result_json) as XTaskOutput } : {}),
    ...(row.error ? { error: row.error } : {}),
    existing
  };
}
