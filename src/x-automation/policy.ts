import { createHash, timingSafeEqual } from 'node:crypto';
import type { XTaskRequest } from './types.js';
import { isMutationAction } from './types.js';

export const X_AUTOMATION_GUIDELINES = [
  'Use the existing real Chrome profile without changing browser fingerprints or user-agent values.',
  'Run only one controller session per account and device.',
  'Observe current state before every action and verify the state afterward.',
  'Use idempotency to avoid duplicate follows, likes, comments, and posts.',
  'Apply explicit daily action budgets and do not retry account-changing actions automatically.',
  'Stop for login, identity, security, rate-limit, or account-status interruptions.',
  'Keep authentication manual and never store X passwords in the automation service.',
  'Use scheduling variation only to distribute workload, not to imitate human behavior or conceal automation.',
  'Require review for generated comments and posts before submission.',
  'Prefer supported platform APIs when they can perform the required authorized workflow.'
] as const;

type Limits = Record<'follow_user' | 'like_post' | 'comment_post' | 'create_post', number>;

export class XPolicy {
  readonly dailyLimits: Limits = {
    follow_user: intEnv('X_MAX_FOLLOWS_PER_DAY', 3),
    like_post: intEnv('X_MAX_LIKES_PER_DAY', 10),
    comment_post: intEnv('X_MAX_COMMENTS_PER_DAY', 3),
    create_post: intEnv('X_MAX_POSTS_PER_DAY', 2)
  };

  validate(request: XTaskRequest): void {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(request.accountId)) throw new Error('accountId must contain 1-80 letters, numbers, underscores, or hyphens.');
    if (!request.serial.trim()) throw new Error('An ADB serial is required.');
    const { payload } = request;
    if (payload.postUrl && !/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(payload.postUrl)) throw new Error('Invalid post URL.');
    if (request.action === 'follow_user' && !payload.username) throw new Error('follow_user requires --username.');
    if ((request.action === 'comment_post' || request.action === 'create_post') && !payload.text?.trim()) {
      throw new Error(`${request.action} requires --text.`);
    }
    if (payload.text && [...payload.text].length > 280) throw new Error('X text must not exceed 280 characters.');
    if (payload.postIndex !== undefined && (!Number.isInteger(payload.postIndex) || payload.postIndex < 0 || payload.postIndex > 9)) {
      throw new Error('postIndex must be between 0 and 9.');
    }
    if (payload.scrolls !== undefined && (!Number.isInteger(payload.scrolls) || payload.scrolls < 1 || payload.scrolls > 5)) {
      throw new Error('scrolls must be between 1 and 5.');
    }
    if (payload.limit !== undefined && (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 20)) {
      throw new Error('limit must be between 1 and 20.');
    }
  }

  authorizeMutation(request: XTaskRequest, committedToday: number): void {
    if (!isMutationAction(request.action) || request.mode !== 'commit') return;
    const expectedToken = process.env.X_AUTOMATION_APPROVAL_TOKEN || '';
    if (!expectedToken || !request.approvalToken || !safeEqual(expectedToken, request.approvalToken)) {
      throw new Error('Commit mode requires a valid X_AUTOMATION_APPROVAL_TOKEN.');
    }
    const limit = this.dailyLimits[request.action];
    if (committedToday >= limit) throw new Error(`Daily ${request.action} budget of ${limit} has been reached for this account.`);
    if (request.action === 'follow_user') {
      const allowed = new Set((process.env.X_ALLOWED_USERS || '').split(',').map((value) => value.trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
      const target = request.payload.username?.replace(/^@/, '').toLowerCase();
      if (!allowed.size || !target || !allowed.has(target)) throw new Error('Commit-mode follows require the target in X_ALLOWED_USERS.');
    }
    if ((request.action === 'comment_post' || request.action === 'create_post') && !request.idempotencyKey) {
      throw new Error('Commit-mode comments and posts require an explicit --idempotency-key.');
    }
  }
}

export function auditPayload(request: XTaskRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...request.payload };
  if (request.payload.text) {
    payload.textLength = [...request.payload.text].length;
    payload.textSha256 = createHash('sha256').update(request.payload.text).digest('hex');
    delete payload.text;
  }
  return payload;
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function safeEqual(left: string, right: string): boolean {
  const expected = Buffer.from(left);
  const supplied = Buffer.from(right);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
