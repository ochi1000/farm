export type PageObservation = {
  url?: string;
  title?: string;
  visibleTextSample?: string;
  visiblePostCount?: number;
  scrollTop?: number;
  scrollHeight?: number;
  timestamp: string;
};

export type XSessionState = {
  loggedIn: boolean;
  accountHandle?: string;
  interruption?: string;
  popups?: string[];
};

export type XPostSummary = {
  index: number;
  author?: string;
  handle?: string;
  text?: string;
  url?: string;
  createdAt?: string;
  liked: boolean;
};

export type XActionResult = {
  action: 'follow_user' | 'like_post' | 'comment_post' | 'create_post';
  dryRun: boolean;
  changed: boolean;
  state: string;
  target?: string;
};

export interface BrowserController {
  connect(serial: string): Promise<void>;
  ensureXOpen(): Promise<void>;
  observe(): Promise<PageObservation>;
  getSessionState(): Promise<XSessionState>;
  readVisibleFeed(limit?: number): Promise<XPostSummary[]>;
  scrollOnce(): Promise<void>;
  followUser(username: string, commit: boolean): Promise<XActionResult>;
  likeVisiblePost(index: number, commit: boolean): Promise<XActionResult>;
  commentOnVisiblePost(index: number, text: string, commit: boolean, expectedUrl?: string): Promise<XActionResult>;
  createPost(text: string, commit: boolean): Promise<XActionResult>;
  reload(): Promise<void>;
  closeActiveTab(): Promise<void>;
  openVisiblePost(index?: number): Promise<void>;
  openPostUrl?(url: string): Promise<void>;
  goBack(): Promise<void>;
  disconnect(): Promise<void>;
}
