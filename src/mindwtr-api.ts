import type { PluginHttp, PluginIssue, PluginSearchResult } from './plugin-api-types';

// All the actual MindWtr API knowledge lives here: request/response shapes
// (MindwtrTask etc.), the HTTP calls themselves, and the pure functions that
// convert between MindWtr's data and the plugin API's shapes (PluginIssue,
// PluginSearchResult). plugin.ts imports from this file but contains none of
// this logic itself — that split keeps the SP-facing "wiring" (plugin.ts)
// separate from the MindWtr-facing "translation" (this file), and makes the
// translation functions individually unit-testable without a fake PluginAPI.
//
// MindWtr's *desktop* Local API only listens on 127.0.0.1, which Super
// Productivity's plugin sandbox blocks for uploaded (non-bundled) plugins —
// there is no override for that. This plugin instead talks to MindWtr's
// self-hosted Cloud Server (`/v1/*`), which is meant to be reachable over a
// real network. Point `host` at wherever you deployed that server.
// Docs: https://docs.mindwtr.app/developers/cloud-api
export const API_PREFIX = 'v1';

export const ACTIVE_STATUSES = [
  'inbox',
  'next',
  'waiting',
  'someday',
  'reference',
] as const;
export type MindwtrActiveStatus = (typeof ACTIVE_STATUSES)[number];

export interface MindwtrConfig {
  host?: string;
  token?: string;
  // Optional: if you also self-host MindWtr's web app/PWA (docs.mindwtr.app/
  // power-users/web-app-pwa) pointed at this same Cloud Server, "Open Issue"
  // links there instead of the raw JSON endpoint. MindWtr currently has no
  // URL scheme for opening one specific task (see README), so this always
  // opens the app's general view, never the task directly.
  webAppUrl?: string;
  // Which of MindWtr's active (non-done, non-archived) statuses to include.
  // Empty/unset = all of them. Filtered client-side (see fetchTasks) so any
  // combination works, e.g. "everything except waiting".
  statusFilters?: string[];
  // Only import/search tasks belonging to one of these projects/areas, or
  // carrying at least one of these tags/contexts. Empty/unset = no filter on
  // that dimension. Tags/contexts options are derived from a live task
  // sample (no dedicated list endpoint for either); projects and areas have
  // real endpoints, see loadProjectOptions/loadAreaOptions.
  projectsFilter?: string[];
  areasFilter?: string[];
  tagsFilter?: string[];
  contextsFilter?: string[];
  // The exclude counterpart to each "…Filter"/"…Filters" field above: same
  // option lists, but fetchTasks applies these AFTER the include filters, as
  // a second narrowing pass rather than a merged/negated set. That ordering
  // is what makes exclude win whenever the same value is checked in both —
  // no separate conflict handling needed, and nothing stops a value from
  // being checked in both (the plugin config API has no way to disable one
  // multiSelect's options based on another field's value).
  statusExcludes?: string[];
  projectsExclude?: string[];
  areasExclude?: string[];
  tagsExclude?: string[];
  contextsExclude?: string[];
  // Off by default: only import/search tasks MindWtr has marked focused-for-
  // today. Passed to the API as a query param (docs list `isFocusedToday` as
  // supported on GET /tasks, no platform caveat for the Cloud API) and also
  // re-checked client-side as a safety net, matching how this plugin treats
  // every other documented-but-unverified API behavior.
  onlyFocusedToday?: boolean;
  // Off by default. When on, MindWtr's due date is never applied to the
  // linked task at all — see mappedFieldsOf below for exactly how. Exists
  // because a MindWtr task with a specific (non-all-day) due time otherwise
  // makes SP schedule the linked task immediately, bypassing the backlog
  // entirely (see CLAUDE.md: "A timed due date bypasses the backlog
  // entirely"), which this setting is the only way to prevent.
  isIgnoreDueDate?: boolean;
  // 'none' (default/unset) or unrecognized: deleting the linked task in SP
  // does nothing to MindWtr. 'archive': calls the reversible archive
  // endpoint. 'delete': calls the (unconfirmed-recoverable) hard delete
  // endpoint — a deliberate, separate opt-in, not the default even when this
  // key is set to something. See deleteMindwtrTask for the reasoning.
  deleteBehavior?: 'none' | 'archive' | 'delete';
}

export interface MindwtrChecklistItem {
  title?: string;
  text?: string;
  done?: boolean;
  completed?: boolean;
  [key: string]: unknown;
}

export interface MindwtrAttachment {
  id: string;
  kind?: string;
  title?: string;
  uri?: string;
  [key: string]: unknown;
}

// Field set per MindWtr's packages/core/src/task-sync-schema.ts (the
// `cloudWrite` "content" fields — this is what the Cloud API can actually
// read/write, since the JSON-response shape itself isn't documented with a
// worked example). Everything here is optional except the identity fields:
// a plain MindWtr task may not set most of these.
export interface MindwtrTask {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  energyLevel?: string | null;
  assignedTo?: string | null;
  startTime?: string | null;
  // Either a bare 'YYYY-MM-DD' (all-day — MindWtr's own date-picker writes
  // this shape when no specific time is set, via its onDateOnly/hasTime
  // toggle) or a full ISO timestamp (a specific time was set). See
  // dueFieldsOf() — this distinction drives whether we map to dueDay or
  // dueWithTime.
  dueDate?: string | null;
  tags?: string[];
  contexts?: string[];
  checklist?: MindwtrChecklistItem[];
  description?: string | null;
  attachments?: MindwtrAttachment[];
  location?: string | null;
  projectId?: string | null;
  sectionId?: string | null;
  areaId?: string | null;
  // A preset ('5min'|'10min'|'15min'|'30min'|'1hr'|'2hr'|'3hr'|'4hr'|'4hr+')
  // or a 'custom:<N>' string — NOT a plain number. Per MindWtr's
  // packages/core/src/types.ts: `type TimeEstimate = TimeEstimatePreset |
  // CustomTimeEstimate` where `CustomTimeEstimate = \`custom:${number}\``.
  timeEstimate?: string | null;
  timeSpentMinutes?: number | null;
  isFocusedToday?: boolean | null;
  // Per MindWtr's packages/core/src/types.ts: `recurrence?: Recurrence |
  // RecurrenceRule` — either the bare string shorthand
  // ('daily'|'weekly'|'monthly'|'yearly') or an object whose base cadence is
  // still `.rule`, plus optional constraints (`until`, `count`, `rrule`,
  // etc). See formatRecurrenceLabel.
  recurrence?: string | { rule?: string; until?: string; count?: number } | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  [key: string]: unknown;
}

export interface MindwtrProject {
  id: string;
  title?: string;
  name?: string;
  [key: string]: unknown;
}

export interface MindwtrArea {
  id: string;
  name?: string;
  title?: string;
  [key: string]: unknown;
}

export interface MindwtrSection {
  id: string;
  title?: string;
  name?: string;
  [key: string]: unknown;
}

export const baseUrl = (cfg: MindwtrConfig): string => {
  const host = (cfg.host || '').replace(/\/+$/, '');
  if (!host) {
    throw new Error('MindWtr host is not configured.');
  }
  return `${host}/${API_PREFIX}`;
};

export const mindwtrHeaders = (cfg: MindwtrConfig): Record<string, string> => {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.token) {
    headers['Authorization'] = `Bearer ${cfg.token}`;
  }
  return headers;
};

// The docs don't pin down whether list endpoints (GET /v1/tasks,
// /v1/projects, /v1/areas) return a bare array or a wrapped
// { tasks/projects/areas: [...] } / { items: [...] } object, so unwrap
// defensively for either shape.
export const unwrapList = <T>(res: unknown, keys: string[]): T[] => {
  if (Array.isArray(res)) {
    return res as T[];
  }
  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(obj[key])) {
        return obj[key] as T[];
      }
    }
  }
  return [];
};

export const unwrapTasks = (res: unknown): MindwtrTask[] =>
  unwrapList<MindwtrTask>(res, ['tasks', 'items', 'data', 'results']);

const labelsOf = (task: MindwtrTask): string[] => [
  ...(task.tags ?? []),
  ...(task.contexts ?? []),
];

const intersects = (a: string[], b: string[]): boolean => {
  const set = new Set(b);
  return a.some((x) => set.has(x));
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// MindWtr's own date-picker (apps/desktop/src/components/
// InboxProcessingScheduleFields.tsx) writes a bare 'YYYY-MM-DD' string via
// its "remove the time component" (onDateOnly / hasTime) control when no
// specific time is set — full ISO timestamps mean a specific time was
// chosen. Unverified: whether the Cloud API preserves this shape distinction
// in its JSON responses, vs. normalizing everything to a full timestamp —
// there's no worked example in the docs either way. If MindWtr due dates
// always import as dueWithTime even for tasks you set as all-day, this
// check is the place to revisit once you can see real API responses.
export const isAllDayDateString = (value: unknown): value is string =>
  typeof value === 'string' && DATE_ONLY_RE.test(value);

export const dueDateToIso = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  if (isAllDayDateString(value)) {
    return value;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const TIME_ESTIMATE_PRESET_MINUTES: Record<string, number> = {
  '5min': 5,
  '10min': 10,
  '15min': 15,
  '30min': 30,
  '1hr': 60,
  '2hr': 120,
  '3hr': 180,
  '4hr': 240,
  // Open-ended top bucket — MindWtr has no exact upper bound here, so this
  // is a floor, not an accurate value.
  '4hr+': 240,
};

// MindWtr's own source has no dedicated parser for this (checked
// packages/core/src and apps/mcp-server/src — timeEstimate isn't even in the
// MCP tool's field schemas), so the unit for `custom:<N>` isn't spelled out
// anywhere. Every preset sibling is minute/hour-scale, so this assumes N is
// minutes too. If MindWtr tasks with a custom estimate import with an
// obviously wrong duration, this is the one place to fix.
export const timeEstimateToMs = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  if (value in TIME_ESTIMATE_PRESET_MINUTES) {
    return TIME_ESTIMATE_PRESET_MINUTES[value] * 60_000;
  }
  const customMatch = /^custom:(\d+(?:\.\d+)?)$/.exec(value);
  if (customMatch) {
    return Math.round(parseFloat(customMatch[1]) * 60_000);
  }
  return undefined;
};

// Reverse of timeEstimateToMs, used both for display and to push a local
// timeEstimate edit back to MindWtr as a preset/custom string.
export const msToTimeEstimate = (ms: unknown): string | undefined => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  const minutes = Math.round(ms / 60_000);
  const preset = Object.entries(TIME_ESTIMATE_PRESET_MINUTES).find(
    ([, m]) => m === minutes,
  );
  return preset ? preset[0] : `custom:${minutes}`;
};

export const formatTimeEstimateLabel = (value: unknown): string | undefined => {
  const ms = timeEstimateToMs(value);
  if (ms === undefined) {
    return undefined;
  }
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
};

const RECURRENCE_RULE_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

// Display-only — recurrence isn't (and can't be) a real syncable field: it's
// not in the plugin API's fixed taskField set, and SP's actual recurring-task
// system (TaskRepeatCfg) is a different, more elaborate concept entirely.
// This is just a human-readable label for MindWtr's own recurrence rule.
export const formatRecurrenceLabel = (
  value: MindwtrTask['recurrence'],
): string | undefined => {
  if (typeof value === 'string') {
    return RECURRENCE_RULE_LABEL[value] ?? value;
  }
  if (value && typeof value === 'object' && value.rule) {
    const base = RECURRENCE_RULE_LABEL[value.rule] ?? value.rule;
    if (value.until) {
      return `${base} until ${value.until}`;
    }
    if (value.count) {
      return `${base} (${value.count}x)`;
    }
    return base;
  }
  return undefined;
};

const checklistProgress = (
  items: MindwtrChecklistItem[] | undefined,
): string | undefined => {
  if (!items || items.length === 0) {
    return undefined;
  }
  const isDone = (item: MindwtrChecklistItem): boolean =>
    !!(item.done ?? item.completed);
  return items
    .map((item) => `- [${isDone(item) ? 'x' : ' '}] ${item.title ?? item.text ?? ''}`)
    .join('\n');
};

const attachmentsMarkdown = (
  attachments: MindwtrAttachment[] | undefined,
): string | undefined => {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  return attachments
    .map((a) => (a.uri ? `- [${a.title || a.uri}](${a.uri})` : `- ${a.title || a.id}`))
    .join('\n');
};

// Builds the `issueField`-keyed values that fieldMappings' toTaskValue
// functions read from (see plugin.ts). Shared between search results (used
// at import time) and full issues (used by getById, i.e. every later poll),
// so a task's fields seed correctly on first import and keep working on
// every later poll or push — see CLAUDE.md's "A field mapping's
// creation-time seed is unconditional" for why that first-import behavior
// isn't optional.
const mappedFieldsOf = (task: MindwtrTask, cfg: MindwtrConfig): Record<string, unknown> => ({
  // _computeIsDone (SP host) reads `.state` even on the object used for
  // initial creation, not just `.status` — set both so a task that's
  // already done in MindWtr imports as done, not just reflects it on the
  // next poll.
  state: task.status,
  descriptionRaw: task.description || undefined,
  tagsLabels: task.tags ?? [],
  // Omitting this key entirely (not just returning null) is what makes
  // isIgnoreDueDate work: the dueDay/dueWithTime mappings' toTaskValue never
  // even runs when their issueField is missing, so this suppresses both the
  // one-time creation seed AND every later poll — unlike the field's own
  // Off/Pull/Push/Both dropdown, which only governs ongoing polls and can't
  // stop the unconditional creation-time seed described above.
  ...(cfg.isIgnoreDueDate ? {} : { dueDateRaw: dueDateToIso(task.dueDate) }),
  timeEstimateRaw: task.timeEstimate || undefined,
});

export const mapSearchResult = (
  task: MindwtrTask,
  cfg: MindwtrConfig,
): PluginSearchResult => ({
  id: task.id,
  title: task.title,
  status: task.status,
  labels: labelsOf(task),
  url: openIssueUrl(cfg, task.id),
  ...mappedFieldsOf(task, cfg),
});

export const taskUrl = (host: string, taskId: string): string =>
  `${(host || '').replace(/\/+$/, '')}/tasks/${taskId}`;

// MindWtr has no URL scheme (web query param or custom mindwtr:// link) that
// opens one specific task — confirmed against apps/desktop/src/App.tsx,
// where GlobalSearch's onNavigate explicitly discards the task id. So the
// best we can do is: link to a self-hosted web app if configured (opens the
// whole app), or fall back to the raw JSON task endpoint (at least confirms
// the task exists and shows its data).
export const openIssueUrl = (cfg: MindwtrConfig, taskId: string): string => {
  const webAppUrl = (cfg.webAppUrl || '').trim().replace(/\/+$/, '');
  if (webAppUrl) {
    return webAppUrl;
  }
  return taskUrl(cfg.host || '', taskId);
};

const nameCache = new Map<string, string>();

// Best-effort only: the raw id is always usable, this just tries to make it
// human-readable. Cached per plugin session (module-scoped, keyed by host so
// repointing `host` at a different server doesn't reuse stale names) so a
// poll cycle across many tasks only fetches each project/area once, and any
// failure (404, network) just falls back to the raw id.
const resolveName = async (
  kind: 'projects' | 'areas' | 'sections',
  id: string,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<string> => {
  const cacheKey = `${cfg.host || ''}::${kind}::${id}`;
  const cached = nameCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  try {
    const resource = await http.get<MindwtrProject | MindwtrArea | MindwtrSection>(
      `${baseUrl(cfg)}/${kind}/${id}`,
    );
    const name = resource?.title || resource?.name || id;
    nameCache.set(cacheKey, name);
    return name;
  } catch {
    return id;
  }
};

export const resolveProjectName = (
  projectId: string,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<string> => resolveName('projects', projectId, cfg, http);

export const resolveAreaName = (
  areaId: string,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<string> => resolveName('areas', areaId, cfg, http);

export const resolveSectionName = (
  sectionId: string,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<string> => resolveName('sections', sectionId, cfg, http);

export const mapTaskToPluginIssue = async (
  task: MindwtrTask,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<PluginIssue> => {
  const [projectName, areaName, sectionName] = await Promise.all([
    task.projectId ? resolveProjectName(task.projectId, cfg, http) : undefined,
    task.areaId ? resolveAreaName(task.areaId, cfg, http) : undefined,
    task.sectionId ? resolveSectionName(task.sectionId, cfg, http) : undefined,
  ]);

  return {
    id: task.id,
    title: task.title,
    body: task.description || '',
    url: openIssueUrl(cfg, task.id),
    state: task.status,
    lastUpdated: Date.parse(task.updatedAt) || undefined,
    labels: labelsOf(task),
    assignee: task.assignedTo || undefined,

    // Extended fields for the issue-display panel
    summary: task.title,
    dueDate: task.dueDate || undefined,
    startTime: task.startTime || undefined,
    priority: task.priority || undefined,
    energyLevel: task.energyLevel || undefined,
    location: task.location || undefined,
    project: projectName,
    area: areaName,
    section: sectionName,
    checklistMarkdown: checklistProgress(task.checklist),
    attachmentsMarkdown: attachmentsMarkdown(task.attachments),
    description: task.description || '',
    timeEstimateLabel: formatTimeEstimateLabel(task.timeEstimate),
    focusedTodayLabel: task.isFocusedToday ? 'Yes' : undefined,
    recurrenceLabel: formatRecurrenceLabel(task.recurrence),
    ...mappedFieldsOf(task, cfg),
  };
};

export const fetchTasks = async (
  searchTerm: string,
  config: MindwtrConfig,
  http: PluginHttp,
): Promise<MindwtrTask[]> => {
  const base = baseUrl(config);
  const params: Record<string, string> = { limit: '100' };
  const trimmed = searchTerm.trim();
  if (trimmed) {
    params['query'] = trimmed;
  }
  if (config.onlyFocusedToday) {
    params['isFocusedToday'] = 'true';
  }
  // Status is filtered client-side (not passed to the API) since a
  // multi-status selection can't be expressed in the single-value `status`
  // query param the docs describe, and this keeps single- vs multi-select
  // behavior identical instead of branching.
  const res = await http.get(`${base}/tasks`, { params });
  let tasks = unwrapTasks(res);

  if (config.onlyFocusedToday) {
    // Re-checked client-side in case the server ignores the param — same
    // "don't fully trust an unverified query param" approach as everywhere
    // else in this plugin.
    tasks = tasks.filter((task) => !!task.isFocusedToday);
  }
  if (config.projectsFilter && config.projectsFilter.length > 0) {
    const allowedProjects = new Set(config.projectsFilter);
    tasks = tasks.filter(
      (task) => !!task.projectId && allowedProjects.has(task.projectId),
    );
  }
  if (config.areasFilter && config.areasFilter.length > 0) {
    const allowedAreas = new Set(config.areasFilter);
    tasks = tasks.filter((task) => !!task.areaId && allowedAreas.has(task.areaId));
  }
  if (config.statusFilters && config.statusFilters.length > 0) {
    const allowed = new Set(config.statusFilters);
    tasks = tasks.filter((task) => allowed.has(task.status));
  }
  if (config.tagsFilter && config.tagsFilter.length > 0) {
    tasks = tasks.filter((task) => intersects(task.tags ?? [], config.tagsFilter!));
  }
  if (config.contextsFilter && config.contextsFilter.length > 0) {
    tasks = tasks.filter((task) =>
      intersects(task.contexts ?? [], config.contextsFilter!),
    );
  }
  // Exclude filters run last, as a second narrowing pass over whatever the
  // include filters above already kept — so checking the same value in both
  // an include and its exclude counterpart always results in exclusion.
  if (config.projectsExclude && config.projectsExclude.length > 0) {
    const excludedProjects = new Set(config.projectsExclude);
    tasks = tasks.filter(
      (task) => !task.projectId || !excludedProjects.has(task.projectId),
    );
  }
  if (config.areasExclude && config.areasExclude.length > 0) {
    const excludedAreas = new Set(config.areasExclude);
    tasks = tasks.filter((task) => !task.areaId || !excludedAreas.has(task.areaId));
  }
  if (config.statusExcludes && config.statusExcludes.length > 0) {
    const excluded = new Set(config.statusExcludes);
    tasks = tasks.filter((task) => !excluded.has(task.status));
  }
  if (config.tagsExclude && config.tagsExclude.length > 0) {
    tasks = tasks.filter((task) => !intersects(task.tags ?? [], config.tagsExclude!));
  }
  if (config.contextsExclude && config.contextsExclude.length > 0) {
    tasks = tasks.filter(
      (task) => !intersects(task.contexts ?? [], config.contextsExclude!),
    );
  }
  return tasks;
};

// Powers the "Tags"/"Contexts" config checkboxes: MindWtr has no dedicated
// "list all tags" endpoint (unlike Projects/Areas, tags/contexts are just
// free-form string[] on tasks), so the option list is derived from whatever
// tags/contexts appear on a broad sample of current tasks. A tag used on
// zero currently-active tasks won't show up here.
const loadUniqueValues = async (
  config: Record<string, unknown>,
  http: PluginHttp,
  pick: (task: MindwtrTask) => string[] | undefined,
): Promise<{ label: string; value: string }[]> => {
  const cfg = config as unknown as MindwtrConfig;
  if (!cfg.host || !cfg.token) {
    return [];
  }
  let tasks: MindwtrTask[];
  try {
    const res = await http.get(`${baseUrl(cfg)}/tasks`, { params: { limit: '500' } });
    tasks = unwrapTasks(res);
  } catch {
    return [];
  }
  const values = new Set<string>();
  for (const task of tasks) {
    for (const v of pick(task) ?? []) {
      values.add(v);
    }
  }
  return [...values].sort().map((v) => ({ label: v, value: v }));
};

export const loadTagOptions = (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> =>
  loadUniqueValues(config, http, (task) => task.tags);

export const loadContextOptions = (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> =>
  loadUniqueValues(config, http, (task) => task.contexts);

// Projects and Areas are real resources with dedicated endpoints (unlike
// tags/contexts), so these list the whole collection directly instead of
// deriving options from a task sample.
const loadResourceOptions = async (
  kind: 'projects' | 'areas',
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const cfg = config as unknown as MindwtrConfig;
  if (!cfg.host || !cfg.token) {
    return [];
  }
  try {
    const res = await http.get(`${baseUrl(cfg)}/${kind}`, { params: { limit: '200' } });
    const resources = unwrapList<MindwtrProject | MindwtrArea>(res, [
      kind,
      'items',
      'data',
      'results',
    ]);
    return resources
      .map((r) => ({ label: r.title || r.name || r.id, value: r.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
};

export const loadProjectOptions = (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> =>
  loadResourceOptions('projects', config, http);

export const loadAreaOptions = (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => loadResourceOptions('areas', config, http);

// Creates a brand-new MindWtr task from an SP task added directly to this
// provider's Default Project (only reachable when "Auto-create issues" is
// on — see plugin-api-types.ts). MindWtr assigns no human-readable sequence
// number to tasks (unlike, say, GitHub's #123), so issueNumber is omitted —
// the host only prefixes the title with one when present.
export const createMindwtrTask = async (
  title: string,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<{ issueId: string; issueData: PluginIssue }> => {
  const created = await http.post<MindwtrTask>(`${baseUrl(cfg)}/tasks`, { title });
  const issueData = await mapTaskToPluginIssue(created, cfg, http);
  return { issueId: created.id, issueData };
};

// Pushes local changes back to MindWtr. `changes` is keyed by our own
// fieldMappings' `issueField` names (see plugin.ts) — this is the only
// consumer of those keys, so they only need to agree with each other, not
// with anything else.
//
// isDone is special-cased: MindWtr has no PATCH-able "status" transition
// into done — completion is only reachable via the dedicated
// POST /tasks/:id/complete endpoint (the docs: "Cannot reopen done/archived
// tasks via PATCH"). There's no documented way to push "reopen" (done ->
// not done) at all, so that direction is silently skipped — MindWtr treats
// completion as one-way once you're through the dedicated endpoint.
export const updateMindwtrTask = async (
  issueId: string,
  changes: Record<string, unknown>,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<void> => {
  const base = baseUrl(cfg);

  if (changes.state === 'done') {
    await http.post(`${base}/tasks/${issueId}/complete`, {});
  }

  const patchBody: Record<string, unknown> = {};
  if (typeof changes.title === 'string') {
    patchBody.title = changes.title;
  }
  if (typeof changes.descriptionRaw === 'string') {
    patchBody.description = changes.descriptionRaw;
  }
  if (typeof changes.timeEstimateRaw === 'string') {
    patchBody.timeEstimate = changes.timeEstimateRaw;
  }
  if (Array.isArray(changes.tagsLabels)) {
    patchBody.tags = changes.tagsLabels;
  }
  if (typeof changes.dueDateRaw === 'string') {
    patchBody.dueDate = changes.dueDateRaw;
  }

  if (Object.keys(patchBody).length > 0) {
    await http.patch(`${base}/tasks/${issueId}`, patchBody);
  }
};

// 'none' by default (cfg.deleteBehavior unset or 'none'). Deleting a task in
// SP — the linked mirror or, in principle, a duplicate that somehow got
// linked — never touches MindWtr unless this is explicitly turned on, since
// MindWtr is the master list and a stray local delete shouldn't be able to
// take real data with it.
//
// 'archive' calls the reversible archive endpoint rather than deleting.
// Archiving accomplishes the same practical goal (MindWtr stops treating it
// as active) while being confirmed-reversible: MindWtr's docs group
// `/restore` alongside `/complete` and `/archive` as "dedicated endpoints
// for terminal operations," implying it undoes either.
//
// 'delete' calls the real DELETE /tasks/:id endpoint — a separate, more
// dangerous opt-in. The docs never confirm whether it's recoverable for
// tasks specifically (only that projects/areas/sections use tombstones, and
// that a `deleted=1` list param exists for tasks too, which suggests but
// doesn't confirm the same). Treat it as permanent until verified against a
// real server; 'archive' is the safer choice for most people asking "clean
// this up in MindWtr too" without meaning to risk data loss.
export const deleteMindwtrTask = async (
  issueId: string,
  cfg: MindwtrConfig,
  http: PluginHttp,
): Promise<void> => {
  if (cfg.deleteBehavior === 'archive') {
    await http.post(`${baseUrl(cfg)}/tasks/${issueId}/archive`, {});
  } else if (cfg.deleteBehavior === 'delete') {
    await http.delete(`${baseUrl(cfg)}/tasks/${issueId}`);
  }
};
