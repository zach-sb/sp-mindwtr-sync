// Vendored from Super Productivity's packages/plugin-api/src/issue-provider-types.ts
// (trimmed to what this plugin uses). Vendored rather than imported from the
// `@super-productivity/plugin-api` npm package because the published 1.0.1
// release doesn't re-export these types yet — only the SP monorepo's local
// copy does, and depending on that would mean keeping a clone of the whole
// SP repo around just to build this plugin. These are type-only (erased by
// esbuild at build time), so there's no runtime coupling either way — update
// this file by hand if the real package's shape changes.

export interface PluginSearchResult {
  id: string;
  title: string;
  url?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  [key: string]: unknown;
}

export interface PluginIssue {
  id: string;
  title: string;
  body?: string;
  url?: string;
  state?: string;
  lastUpdated?: number;
  assignee?: string;
  labels?: string[];
  comments?: PluginIssueComment[];
  [key: string]: unknown;
}

export interface PluginIssueComment {
  author: string;
  body: string;
  created: number;
  [key: string]: unknown;
}

export interface PluginIssueField {
  field: string;
  label: string;
  type?: 'text' | 'markdown' | 'link' | 'date' | 'list';
  linkField?: string;
  hideEmpty?: boolean;
}

export interface PluginCommentsConfig {
  authorField?: string;
  bodyField?: string;
  createdField?: string;
  avatarField?: string;
  sortField?: string;
}

export type PluginSyncDirection = 'off' | 'pullOnly' | 'pushOnly' | 'both';

export interface PluginFieldMapping {
  taskField:
    | 'isDone'
    | 'title'
    | 'notes'
    | 'dueDay'
    | 'dueWithTime'
    | 'timeEstimate'
    | 'tagIds';
  issueField: string;
  defaultDirection: PluginSyncDirection;
  mutuallyExclusive?: string[];
  toIssueValue(
    taskValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
  toTaskValue(
    issueValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
}

export interface PluginFormField {
  key: string;
  type:
    | 'input'
    | 'password'
    | 'textarea'
    | 'checkbox'
    | 'select'
    | 'multiSelect'
    | 'link'
    | 'oauthButton';
  label: string;
  required?: boolean;
  description?: string;
  options?: { label: string; value: string }[];
  url?: string;
  pattern?: string;
  advanced?: boolean;
  showIf?: string;
  /** For 'select'/'multiSelect': dynamically load options at runtime (e.g.
   * from the provider's own API), rendered as checkboxes for multiSelect. */
  loadOptions?(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ label: string; value: string }[]>;
}

export interface PluginHttpOptions {
  params?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: 'json' | 'text';
}

export interface PluginHttp {
  get<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
  post<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  put<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  patch<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  delete<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
  request<T = unknown>(
    method: string,
    url: string,
    body?: unknown,
    options?: PluginHttpOptions,
  ): Promise<T>;
}

export interface IssueProviderPluginDefinition {
  configFields: PluginFormField[];
  getHeaders(
    config: Record<string, unknown>,
  ): Record<string, string> | Promise<Record<string, string>>;
  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue>;
  getIssueLink(issueId: string, config: Record<string, unknown>): string;
  testConnection?(config: Record<string, unknown>, http: PluginHttp): Promise<boolean>;
  getNewIssuesForBacklog?(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  issueDisplay: PluginIssueField[];
  commentsConfig?: PluginCommentsConfig;
  fieldMappings?: PluginFieldMapping[];
  extractSyncValues?(issue: PluginIssue): Record<string, unknown>;
  /** Push local changes for mapped fields back to the issue. Declaring this
   * is what unlocks Push/Both as options in the per-field sync-direction
   * dropdown SP auto-generates — without it, every direction normalizes to
   * pull-only regardless of what's configured. */
  updateIssue?(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void>;
  /** Called when the locally linked task is deleted. Declaring this is what
   * wires local deletion into the remote call at all — the host checks for
   * its existence before doing anything, so a plugin that wants delete-push
   * to be optional (e.g. a config checkbox) has to gate that *inside* this
   * function, not by conditionally declaring it. */
  deleteIssue?(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void>;
  /** Issue states that mean "this was removed remotely" — SP treats a task
   * whose issue enters one of these states as gone (with the usual
   * time-tracked warning) rather than erroring on a 404 from the next poll. */
  deletedStates?: string[];
  /** Called when a new, unlinked task is added directly to this provider's
   * configured Default Project. Declaring this is what unlocks the
   * "Auto-create issues" checkbox the host auto-generates (disabled unless a
   * Default Project is set) — same on/off-by-declaration pattern as
   * updateIssue/deleteIssue. On success the host immediately links the local
   * task to the returned issueId (title, type, provider id all get set), so
   * this is a one-shot "create remotely + link back," not an ongoing thing. */
  createIssue?(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueNumber?: number; issueData: PluginIssue }>;
}
