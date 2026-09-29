import type { XActionResult, XPostSummary, XSessionState } from '../browser/types.js';

export const X_ACTIONS = [
  'read_feed',
  'scroll_feed',
  'follow_user',
  'like_post',
  'comment_post',
  'create_post'
] as const;

export type XAction = (typeof X_ACTIONS)[number];
export type XMutationAction = 'follow_user' | 'like_post' | 'comment_post' | 'create_post';
export type XTaskMode = 'dry-run' | 'commit';

export type XTaskPayload = {
  username?: string;
  text?: string;
  postIndex?: number;
  postUrl?: string;
  scrolls?: number;
  limit?: number;
};

export type XTaskRequest = {
  accountId: string;
  deviceId: string;
  serial: string;
  action: XAction;
  mode: XTaskMode;
  payload: XTaskPayload;
  approvalToken?: string;
  idempotencyKey?: string;
  closeTabAfter?: boolean;
};

export type XTaskOutput = {
  taskId: string;
  action: XAction;
  mode: XTaskMode;
  startedAt: string;
  finishedAt: string;
  session: XSessionState;
  screenOffMaintained: boolean;
  recoveries?: string[];
  posts?: XPostSummary[];
  observation?: Record<string, unknown>;
  actionResult?: XActionResult;
};

export type StoredTask = {
  id: string;
  status: string;
  result?: XTaskOutput;
  error?: string;
  existing: boolean;
};

export function isMutationAction(action: XAction): action is XMutationAction {
  return action === 'follow_user' || action === 'like_post' || action === 'comment_post' || action === 'create_post';
}
