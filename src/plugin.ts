// Plugin entry point. Esbuild bundles this file (and everything it imports
// from mindwtr-api.ts) into a single dist/plugin.js, which Super Productivity
// loads and runs once per session. The only thing this file does at the top
// level is build one big object describing "how to talk to MindWtr" and hand
// it to PluginAPI.registerIssueProvider — everything below is either that
// object's fields or small helpers used while building it.
import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from './plugin-api-types';
import {
  ACTIVE_STATUSES,
  baseUrl,
  createMindwtrTask,
  deleteMindwtrTask,
  fetchTasks,
  isAllDayDateString,
  loadAreaOptions,
  loadContextOptions,
  loadProjectOptions,
  loadTagOptions,
  mapSearchResult,
  mapTaskToPluginIssue,
  MindwtrConfig,
  MindwtrTask,
  mindwtrHeaders,
  msToTimeEstimate,
  openIssueUrl,
  timeEstimateToMs,
  updateMindwtrTask,
} from './mindwtr-api';

// Not imported from anywhere — the SP host injects this as a real global
// before running plugin.js, so `declare const` just tells TypeScript it
// exists. registerIssueProvider is the one required call every issue-provider
// plugin must make; translate() reads this plugin's own i18n/en.json.
declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

// Small wrapper so a missing/unresolved translation key degrades to showing
// the raw key instead of throwing and breaking plugin registration entirely.
const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

// Every hook below receives config as `Record<string, unknown>` because the
// plugin API's types can't know this plugin's own config shape — it's just
// whatever configFields produced. This cast recovers our real MindwtrConfig
// type for internal use; nothing here validates the shape at runtime.
const asConfig = (config: Record<string, unknown>): MindwtrConfig =>
  config as unknown as MindwtrConfig;

// Shared by searchIssues (the search box in SP's task-creation panel) and
// getNewIssuesForBacklog (SP's periodic "pull in new tasks" sweep) below —
// both are really the same query ("give me matching MindWtr tasks as
// PluginSearchResult"), just with searchTerm empty for the backlog sweep.
const search = async (
  searchTerm: string,
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const cfg = asConfig(config);
  const tasks = await fetchTasks(searchTerm, cfg, http);
  return tasks.map((task) => mapSearchResult(task, cfg));
};

// Translates MindWtr's raw status strings (used as multiSelect option
// *values* below) to this plugin's own i18n keys (used as their display
// *labels*) — keeps the "Statuses to include" filter list readable and
// translatable instead of showing MindWtr's internal spelling verbatim.
const STATUS_LABEL_KEY: Record<(typeof ACTIVE_STATUSES)[number], string> = {
  inbox: 'CFG.STATUS_INBOX',
  next: 'CFG.STATUS_NEXT',
  waiting: 'CFG.STATUS_WAITING',
  someday: 'CFG.STATUS_SOMEDAY',
  reference: 'CFG.STATUS_REFERENCE',
};

PluginAPI.registerIssueProvider({
  // One entry per field the user sees in "Settings -> Plugins -> MindWtr ->
  // Edit". Two properties recur below and aren't obvious from their names:
  //  - `advanced: true` tucks a field under a collapsible "Advanced" section
  //    in that dialog, so Host/Token stay the only things a new user sees
  //    up front.
  //  - `loadOptions` is an async function SP calls (passing this provider's
  //    own config and an http helper) to fill a multiSelect's option list
  //    dynamically — e.g. real project names fetched from MindWtr, rather
  //    than a hardcoded list here.
  configFields: [
    {
      key: 'host',
      type: 'input',
      label: t('CFG.HOST'),
      required: true,
    },
    {
      key: 'token',
      type: 'password',
      label: t('CFG.TOKEN'),
      required: true,
    },
    {
      key: 'tokenHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN'),
      url: 'https://docs.mindwtr.app/developers/cloud-api',
    },
    {
      key: 'projectsFilter',
      type: 'multiSelect',
      label: t('CFG.PROJECTS_FILTER'),
      description: t('CFG.PROJECTS_FILTER_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadProjectOptions,
    },
    {
      key: 'projectsExclude',
      type: 'multiSelect',
      label: t('CFG.PROJECTS_EXCLUDE'),
      description: t('CFG.PROJECTS_EXCLUDE_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadProjectOptions,
    },
    {
      key: 'areasFilter',
      type: 'multiSelect',
      label: t('CFG.AREAS_FILTER'),
      description: t('CFG.AREAS_FILTER_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadAreaOptions,
    },
    {
      key: 'areasExclude',
      type: 'multiSelect',
      label: t('CFG.AREAS_EXCLUDE'),
      description: t('CFG.AREAS_EXCLUDE_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadAreaOptions,
    },
    {
      key: 'statusFilters',
      type: 'multiSelect',
      label: t('CFG.STATUS_FILTER'),
      description: t('CFG.STATUS_FILTER_DESCRIPTION'),
      required: false,
      advanced: true,
      options: ACTIVE_STATUSES.map((status) => ({
        value: status,
        label: t(STATUS_LABEL_KEY[status]),
      })),
    },
    {
      key: 'statusExcludes',
      type: 'multiSelect',
      label: t('CFG.STATUS_EXCLUDE'),
      description: t('CFG.STATUS_EXCLUDE_DESCRIPTION'),
      required: false,
      advanced: true,
      options: ACTIVE_STATUSES.map((status) => ({
        value: status,
        label: t(STATUS_LABEL_KEY[status]),
      })),
    },
    {
      key: 'tagsFilter',
      type: 'multiSelect',
      label: t('CFG.TAGS_FILTER'),
      description: t('CFG.TAGS_FILTER_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadTagOptions,
    },
    {
      key: 'tagsExclude',
      type: 'multiSelect',
      label: t('CFG.TAGS_EXCLUDE'),
      description: t('CFG.TAGS_EXCLUDE_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadTagOptions,
    },
    {
      key: 'contextsFilter',
      type: 'multiSelect',
      label: t('CFG.CONTEXTS_FILTER'),
      description: t('CFG.CONTEXTS_FILTER_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadContextOptions,
    },
    {
      key: 'contextsExclude',
      type: 'multiSelect',
      label: t('CFG.CONTEXTS_EXCLUDE'),
      description: t('CFG.CONTEXTS_EXCLUDE_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [],
      loadOptions: loadContextOptions,
    },
    {
      key: 'onlyFocusedToday',
      type: 'checkbox',
      label: t('CFG.ONLY_FOCUSED_TODAY'),
      description: t('CFG.ONLY_FOCUSED_TODAY_DESCRIPTION'),
      required: false,
      advanced: true,
    },
    {
      key: 'isIgnoreDueDate',
      type: 'checkbox',
      label: t('CFG.IGNORE_DUE_DATE'),
      description: t('CFG.IGNORE_DUE_DATE_DESCRIPTION'),
      required: false,
      advanced: true,
    },
    {
      key: 'webAppUrl',
      type: 'input',
      label: t('CFG.WEB_APP_URL'),
      description: t('CFG.WEB_APP_URL_DESCRIPTION'),
      required: false,
      advanced: true,
    },
    {
      key: 'deleteBehavior',
      type: 'select',
      label: t('CFG.DELETE_BEHAVIOR'),
      description: t('CFG.DELETE_BEHAVIOR_DESCRIPTION'),
      required: false,
      advanced: true,
      options: [
        { value: 'none', label: t('CFG.DELETE_BEHAVIOR_NONE') },
        { value: 'archive', label: t('CFG.DELETE_BEHAVIOR_ARCHIVE') },
        { value: 'delete', label: t('CFG.DELETE_BEHAVIOR_DELETE') },
      ],
    },
  ],

  // Called before every HTTP request SP makes on this provider's behalf (via
  // the `http` helper passed into the hooks below), so the bearer token from
  // config ends up on every request without each hook building it itself.
  getHeaders(config: Record<string, unknown>): Record<string, string> {
    return mindwtrHeaders(asConfig(config));
  },

  // Powers the search box in SP's task-creation panel: as the user types,
  // SP calls this with their search term and shows the results as pickable
  // suggestions (see `search` above).
  searchIssues: (searchTerm, config, http) => search(searchTerm, config, http),

  // Fetches one task by id. SP calls this both to re-check an already-linked
  // task during polling (has it changed in MindWtr since last time?) and to
  // show its up-to-date details in the issue-display panel. Note this does
  // NOT go through fetchTasks, so none of the "…to include" filters below
  // apply here — a task stays linked and polled even if you later narrow a
  // filter to exclude it.
  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asConfig(config);
    const task = await http.get<MindwtrTask>(`${baseUrl(cfg)}/tasks/${issueId}`);
    return mapTaskToPluginIssue(task, cfg, http);
  },

  // URL behind the "Open Issue" button and the issueDisplay "summary" link
  // below (see the `link`/`linkField: 'url'` entry further down).
  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    return openIssueUrl(asConfig(config), issueId);
  },

  // Backs the "Test Connection" button in the provider's edit dialog. Any
  // successful response counts as success — we don't care about the actual
  // tasks, just that the host/token combination can reach the API at all.
  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    try {
      await http.get(`${baseUrl(asConfig(config))}/tasks`, { params: { limit: '1' } });
      return true;
    } catch {
      return false;
    }
  },

  // SP calls this periodically (per pollIntervalMs in manifest.json) to pull
  // in tasks that aren't linked yet. Empty search term means "no filter on
  // title/text", so this returns everything the config's other filters (Only
  // tasks focused for today, Statuses to include, etc.) allow through.
  getNewIssuesForBacklog: (config, http) => search('', config, http),

  // Defines every row of the "task info" panel SP shows for a linked task.
  // `hideEmpty: true` just means the row is skipped when that field has no
  // value (e.g. most tasks have no `area`), instead of showing an empty row.
  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATUS'), type: 'text' },
    { field: 'project', label: t('DISPLAY.PROJECT'), type: 'text', hideEmpty: true },
    { field: 'area', label: t('DISPLAY.AREA'), type: 'text', hideEmpty: true },
    { field: 'section', label: t('DISPLAY.SECTION'), type: 'text', hideEmpty: true },
    {
      field: 'recurrenceLabel',
      label: t('DISPLAY.RECURRENCE'),
      type: 'text',
      hideEmpty: true,
    },
    {
      field: 'focusedTodayLabel',
      label: t('DISPLAY.FOCUSED_TODAY'),
      type: 'text',
      hideEmpty: true,
    },
    { field: 'priority', label: t('DISPLAY.PRIORITY'), type: 'text', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    {
      field: 'energyLevel',
      label: t('DISPLAY.ENERGY_LEVEL'),
      type: 'text',
      hideEmpty: true,
    },
    { field: 'location', label: t('DISPLAY.LOCATION'), type: 'text', hideEmpty: true },
    { field: 'startTime', label: t('DISPLAY.START_TIME'), type: 'date', hideEmpty: true },
    { field: 'dueDate', label: t('DISPLAY.DUE_DATE'), type: 'date', hideEmpty: true },
    {
      field: 'timeEstimateLabel',
      label: t('DISPLAY.TIME_ESTIMATE'),
      type: 'text',
      hideEmpty: true,
    },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    {
      field: 'checklistMarkdown',
      label: t('DISPLAY.CHECKLIST'),
      type: 'markdown',
      hideEmpty: true,
    },
    {
      field: 'attachmentsMarkdown',
      label: t('DISPLAY.ATTACHMENTS'),
      type: 'markdown',
      hideEmpty: true,
    },
    { field: 'description', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  // Every mapping below defaults to pullOnly (MindWtr is the master list —
  // data flows in by default) but is genuinely push-capable now that
  // updateIssue exists below. SP auto-generates a per-field sync-direction
  // dropdown (Off/Pull/Push/Both) in the provider's edit dialog for every
  // entry here, so any of these can be flipped per your own workflow —
  // nothing here is hardcoded one-way.
  //
  // dueDay and dueWithTime share one issueField (dueDateRaw, the resolved
  // ISO string from MindWtr's dueDate). Only one of them ever produces a
  // value for a given task (they're mutually exclusive both on the SP side
  // and by construction here), based on whether MindWtr's dueDate looks
  // like a bare 'YYYY-MM-DD' (all-day) or a full timestamp (specific time).
  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'state',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue ? 'done' : 'next'),
      toTaskValue: (issueValue: unknown): boolean => issueValue === 'done',
    },
    {
      taskField: 'title',
      issueField: 'title',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
      toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
    },
    {
      taskField: 'notes',
      issueField: 'descriptionRaw',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string | null =>
        typeof taskValue === 'string' ? taskValue : null,
      toTaskValue: (issueValue: unknown): string | undefined =>
        typeof issueValue === 'string' ? issueValue : undefined,
    },
    {
      // Only MindWtr's `tags` — never `contexts` or `areaId`. Pushing a
      // combined set back would write context/area names into MindWtr's
      // actual tags field, since a mapping can only push into the one
      // MindWtr field it's declared against.
      taskField: 'tagIds',
      issueField: 'tagsLabels',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string[] | null =>
        Array.isArray(taskValue) ? (taskValue as string[]) : null,
      toTaskValue: (issueValue: unknown): string[] =>
        Array.isArray(issueValue) ? (issueValue as string[]) : [],
    },
    {
      taskField: 'dueDay',
      issueField: 'dueDateRaw',
      defaultDirection: 'pullOnly',
      mutuallyExclusive: ['dueWithTime'],
      toIssueValue: (taskValue: unknown): string | null =>
        typeof taskValue === 'string' ? taskValue : null,
      toTaskValue: (issueValue: unknown): string | undefined =>
        isAllDayDateString(issueValue) ? issueValue : undefined,
    },
    {
      taskField: 'dueWithTime',
      issueField: 'dueDateRaw',
      defaultDirection: 'pullOnly',
      mutuallyExclusive: ['dueDay'],
      toIssueValue: (taskValue: unknown): string | null =>
        typeof taskValue === 'number' ? new Date(taskValue).toISOString() : null,
      toTaskValue: (issueValue: unknown): number | undefined => {
        if (typeof issueValue !== 'string' || isAllDayDateString(issueValue)) {
          return undefined;
        }
        const ms = Date.parse(issueValue);
        return Number.isNaN(ms) ? undefined : ms;
      },
    },
    {
      taskField: 'timeEstimate',
      issueField: 'timeEstimateRaw',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string | null =>
        msToTimeEstimate(taskValue) ?? null,
      toTaskValue: (issueValue: unknown): number => timeEstimateToMs(issueValue) ?? 0,
    },
  ] satisfies PluginFieldMapping[],

  // After every import and every poll, SP snapshots this function's return
  // value as the task's "last known synced state" (issueLastSyncedValues).
  // The next poll diffs a fresh call against that snapshot to work out what
  // actually changed on the MindWtr side — so this must return one raw value
  // per issueField named in fieldMappings above, using the exact same keys.
  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      state: issue.state,
      title: issue.title,
      descriptionRaw: issue['descriptionRaw'],
      tagsLabels: issue['tagsLabels'],
      dueDateRaw: issue['dueDateRaw'],
      timeEstimateRaw: issue['timeEstimateRaw'],
    };
  },

  // See updateMindwtrTask for exactly how each field translates to a
  // MindWtr API call, and why isDone can only push true (done), never false.
  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    await updateMindwtrTask(id, changes, asConfig(config), http);
  },

  // Always declared so the host wires local deletion into this at all — the
  // "off by default" behavior lives inside deleteMindwtrTask itself (gated
  // on cfg.deleteBehavior), not in whether this function exists.
  async deleteIssue(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    await deleteMindwtrTask(id, asConfig(config), http);
  },

  // 'done' is NOT here — that's a real completion, handled correctly by the
  // isDone mapping above. Only 'archived' means "treat as gone": SP handles
  // it via its normal remote-deletion flow (warns if time was tracked, etc)
  // instead of erroring on a 404 from a later poll. Not a config option —
  // deletedStates is a static declaration the host reads once, not something
  // the field-mapping/config system can gate per-provider-instance.
  deletedStates: ['archived'],

  // Declaring this auto-generates an "Auto-create issues" checkbox in the
  // provider's edit dialog — same on/off-by-declaration pattern as
  // updateIssue/deleteIssue, no config field of our own needed. Default off,
  // and disabled entirely unless a Default Project is set (host behavior,
  // not this plugin's). Fires only for a new, unlinked task added directly
  // to that Default Project — see CLAUDE.md's "createIssue's real risk is
  // unwanted linking" section for the interaction with SP's Duplicate Task.
  async createIssue(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueNumber?: number; issueData: PluginIssue }> {
    return createMindwtrTask(title, asConfig(config), http);
  },
});
