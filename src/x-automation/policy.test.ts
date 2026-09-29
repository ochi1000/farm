import assert from 'node:assert/strict';
import test from 'node:test';
import { XPolicy, auditPayload } from './policy.js';
import type { XTaskRequest } from './types.js';

function request(overrides: Partial<XTaskRequest> = {}): XTaskRequest {
  return {
    accountId: 'lab-account',
    deviceId: 'device-1',
    serial: 'adb-serial',
    action: 'read_feed',
    mode: 'dry-run',
    payload: {},
    ...overrides
  };
}

test('dry-run mutation validates without an approval token', () => {
  const policy = new XPolicy();
  const task = request({ action: 'follow_user', payload: { username: 'approved_user' } });
  policy.validate(task);
  policy.authorizeMutation(task, 0);
});

test('commit mutation requires token, allowlist, and available budget', () => {
  const previousToken = process.env.X_AUTOMATION_APPROVAL_TOKEN;
  const previousUsers = process.env.X_ALLOWED_USERS;
  process.env.X_AUTOMATION_APPROVAL_TOKEN = 'test-approval-token';
  process.env.X_ALLOWED_USERS = 'approved_user';
  try {
    const policy = new XPolicy();
    const task = request({
      action: 'follow_user',
      mode: 'commit',
      approvalToken: 'test-approval-token',
      payload: { username: '@approved_user' }
    });
    policy.validate(task);
    policy.authorizeMutation(task, 0);
    assert.throws(() => policy.authorizeMutation({ ...task, approvalToken: 'wrong' }, 0), /valid X_AUTOMATION_APPROVAL_TOKEN/);
    assert.throws(() => policy.authorizeMutation({ ...task, payload: { username: 'not_allowed' } }, 0), /X_ALLOWED_USERS/);
    assert.throws(() => policy.authorizeMutation(task, policy.dailyLimits.follow_user), /budget/);
  } finally {
    restore('X_AUTOMATION_APPROVAL_TOKEN', previousToken);
    restore('X_ALLOWED_USERS', previousUsers);
  }
});

test('stored audit payload hashes post text', () => {
  const payload = auditPayload(request({ action: 'create_post', payload: { text: 'reviewed message' } }));
  assert.equal(payload.text, undefined);
  assert.equal(payload.textLength, 16);
  assert.match(String(payload.textSha256), /^[a-f0-9]{64}$/);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
