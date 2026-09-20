import { describe, it, expect, vi } from 'vitest';
import type { PluginHttp } from './plugin-api-types';
import {
  baseUrl,
  dueDateToIso,
  fetchTasks,
  formatRecurrenceLabel,
  formatTimeEstimateLabel,
  isAllDayDateString,
  loadAreaOptions,
  loadContextOptions,
  loadProjectOptions,
  loadTagOptions,
  mapSearchResult,
  mapTaskToPluginIssue,
  mindwtrHeaders,
  msToTimeEstimate,
  openIssueUrl,
  resolveAreaName,
  resolveProjectName,
  resolveSectionName,
  taskUrl,
  timeEstimateToMs,
  unwrapTasks,
  updateMindwtrTask,
  deleteMindwtrTask,
  createMindwtrTask,
  MindwtrTask,
} from './mindwtr-api';

const mockTask = (overrides: Partial<MindwtrTask> = {}): MindwtrTask => ({
  id: 't1',
  title: 'Test task',
  status: 'next',
  projectId: null,
  areaId: null,
  dueDate: null,
  description: null,
  tags: [],
  contexts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

const mockHttp = (responses: Record<string, unknown> = {}): PluginHttp => ({
  get: vi.fn(async (url: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) return response;
    }
    throw new Error(`No mock for ${url}`);
  }),
  post: vi.fn(async () => undefined),
  put: vi.fn(),
  patch: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  request: vi.fn(),
});

describe('baseUrl', () => {
  it('strips trailing slashes and appends /v1', () => {
    expect(baseUrl({ host: 'https://mindwtr.example.com/' })).toBe(
      'https://mindwtr.example.com/v1',
    );
    expect(baseUrl({ host: 'https://mindwtr.example.com' })).toBe(
      'https://mindwtr.example.com/v1',
    );
  });

  it('throws when host is not configured', () => {
    expect(() => baseUrl({})).toThrow();
  });
});

describe('mindwtrHeaders', () => {
  it('adds a Bearer authorization header when a token is set', () => {
    expect(mindwtrHeaders({ token: 'abc' })).toEqual({
      accept: 'application/json',
      Authorization: 'Bearer abc',
    });
  });

  it('omits Authorization when no token is set', () => {
    expect(mindwtrHeaders({})).toEqual({ accept: 'application/json' });
  });
});

describe('unwrapTasks', () => {
  it('passes through a bare array', () => {
    const tasks = [mockTask()];
    expect(unwrapTasks(tasks)).toBe(tasks);
  });

  it('unwraps a { tasks: [...] } response', () => {
    const tasks = [mockTask()];
    expect(unwrapTasks({ tasks })).toBe(tasks);
  });

  it('unwraps a { items: [...] } response', () => {
    const tasks = [mockTask()];
    expect(unwrapTasks({ items: tasks })).toBe(tasks);
  });

  it('returns an empty array for an unrecognized shape', () => {
    expect(unwrapTasks({ foo: 'bar' })).toEqual([]);
    expect(unwrapTasks(null)).toEqual([]);
  });
});

describe('taskUrl', () => {
  it('strips a trailing slash from host', () => {
    expect(taskUrl('https://mindwtr.example.com/', 't1')).toBe(
      'https://mindwtr.example.com/tasks/t1',
    );
  });
});

describe('openIssueUrl', () => {
  it('prefers webAppUrl when set', () => {
    expect(
      openIssueUrl({ host: 'https://h', webAppUrl: 'https://app.example.com/' }, 't1'),
    ).toBe('https://app.example.com');
  });

  it('falls back to the raw task JSON endpoint', () => {
    expect(openIssueUrl({ host: 'https://h' }, 't1')).toBe('https://h/tasks/t1');
  });
});

describe('isAllDayDateString', () => {
  it('recognizes a bare YYYY-MM-DD string', () => {
    expect(isAllDayDateString('2026-02-01')).toBe(true);
  });

  it('rejects a full ISO timestamp', () => {
    expect(isAllDayDateString('2026-02-01T09:00:00.000Z')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isAllDayDateString(undefined)).toBe(false);
    expect(isAllDayDateString(123)).toBe(false);
  });
});

describe('dueDateToIso', () => {
  it('passes an all-day date string through unchanged', () => {
    expect(dueDateToIso('2026-02-01')).toBe('2026-02-01');
  });

  it('normalizes a full timestamp to ISO', () => {
    expect(dueDateToIso('2026-02-01T09:00:00.000Z')).toBe('2026-02-01T09:00:00.000Z');
  });

  it('returns null for missing or invalid input', () => {
    expect(dueDateToIso(null)).toBeNull();
    expect(dueDateToIso('not-a-date')).toBeNull();
  });
});

describe('timeEstimateToMs / msToTimeEstimate', () => {
  it('converts known presets to ms', () => {
    expect(timeEstimateToMs('15min')).toBe(15 * 60_000);
    expect(timeEstimateToMs('1hr')).toBe(60 * 60_000);
  });

  it('converts a custom:<N> value as N minutes', () => {
    expect(timeEstimateToMs('custom:45')).toBe(45 * 60_000);
  });

  it('returns undefined for unrecognized or missing values', () => {
    expect(timeEstimateToMs(undefined)).toBeUndefined();
    expect(timeEstimateToMs('not-a-value')).toBeUndefined();
  });

  it('round-trips a preset-aligned ms value back to its preset string', () => {
    expect(msToTimeEstimate(30 * 60_000)).toBe('30min');
  });

  it('falls back to custom:<N> for a non-preset ms value', () => {
    expect(msToTimeEstimate(45 * 60_000)).toBe('custom:45');
  });
});

describe('formatTimeEstimateLabel', () => {
  it('formats sub-hour presets in minutes', () => {
    expect(formatTimeEstimateLabel('15min')).toBe('15 min');
  });

  it('formats hour-scale presets in hours', () => {
    expect(formatTimeEstimateLabel('2hr')).toBe('2 hr');
  });

  it('formats a custom value that lands on a fractional hour', () => {
    expect(formatTimeEstimateLabel('custom:90')).toBe('1.5 hr');
  });

  it('returns undefined for no estimate', () => {
    expect(formatTimeEstimateLabel(undefined)).toBeUndefined();
  });
});

describe('formatRecurrenceLabel', () => {
  it('formats the bare string shorthand', () => {
    expect(formatRecurrenceLabel('weekly')).toBe('Weekly');
  });

  it('passes through an unrecognized string as-is', () => {
    expect(formatRecurrenceLabel('fortnightly')).toBe('fortnightly');
  });

  it('formats the object form using its base rule', () => {
    expect(formatRecurrenceLabel({ rule: 'monthly' })).toBe('Monthly');
  });

  it('appends an until date when present', () => {
    expect(formatRecurrenceLabel({ rule: 'daily', until: '2026-12-31' })).toBe(
      'Daily until 2026-12-31',
    );
  });

  it('appends a count when present and no until date', () => {
    expect(formatRecurrenceLabel({ rule: 'yearly', count: 5 })).toBe('Yearly (5x)');
  });

  it('returns undefined for no recurrence', () => {
    expect(formatRecurrenceLabel(undefined)).toBeUndefined();
    expect(formatRecurrenceLabel(null)).toBeUndefined();
  });
});

describe('mapSearchResult', () => {
  it('combines tags and contexts into labels, but keeps tagsLabels to just tags', () => {
    const task = mockTask({
      tags: ['#work'],
      contexts: ['@phone'],
      dueDate: '2026-02-01T09:00:00.000Z',
    });
    const result = mapSearchResult(task, { host: 'https://h' });
    expect(result.labels).toEqual(['#work', '@phone']);
    expect(result['tagsLabels']).toEqual(['#work']);
  });

  it('seeds state, dueDateRaw and url', () => {
    const task = mockTask({ dueDate: '2026-02-01' });
    const result = mapSearchResult(task, { host: 'https://h' });
    expect(result['state']).toBe('next');
    expect(result['dueDateRaw']).toBe('2026-02-01');
    expect(result.url).toBe('https://h/tasks/t1');
  });

  it('omits dueDateRaw entirely when isIgnoreDueDate is on, even with a due date set', () => {
    const task = mockTask({ dueDate: '2026-02-01T09:00:00.000Z' });
    const result = mapSearchResult(task, { host: 'https://h', isIgnoreDueDate: true });
    expect('dueDateRaw' in result).toBe(false);
  });

  it('still seeds dueDateRaw when isIgnoreDueDate is explicitly off', () => {
    const task = mockTask({ dueDate: '2026-02-01' });
    const result = mapSearchResult(task, { host: 'https://h', isIgnoreDueDate: false });
    expect(result['dueDateRaw']).toBe('2026-02-01');
  });
});

describe('resolveProjectName / resolveAreaName', () => {
  it('resolves and caches a project name', async () => {
    const http = mockHttp({ '/v1/projects/p1': { id: 'p1', title: 'Home' } });
    const cfg = { host: `https://h${Math.random()}` };
    const first = await resolveProjectName('p1', cfg, http);
    const second = await resolveProjectName('p1', cfg, http);
    expect(first).toBe('Home');
    expect(second).toBe('Home');
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('resolves an area name independently of projects', async () => {
    const http = mockHttp({ '/v1/areas/a1': { id: 'a1', name: 'Personal' } });
    const result = await resolveAreaName('a1', { host: 'https://h' }, http);
    expect(result).toBe('Personal');
  });

  it('resolves a section name independently of projects/areas', async () => {
    const http = mockHttp({ '/v1/sections/s1': { id: 's1', title: 'Groceries' } });
    const result = await resolveSectionName('s1', { host: 'https://h' }, http);
    expect(result).toBe('Groceries');
  });

  it('falls back to the raw id on failure', async () => {
    const http = mockHttp({});
    const result = await resolveProjectName('missing-project', { host: 'https://h' }, http);
    expect(result).toBe('missing-project');
  });
});

describe('mapTaskToPluginIssue', () => {
  it('maps core and extended fields, resolving project, area and section names', async () => {
    const http = mockHttp({
      '/v1/projects/p1': { id: 'p1', title: 'Home' },
      '/v1/areas/a1': { id: 'a1', name: 'Personal' },
      '/v1/sections/s1': { id: 's1', title: 'Groceries' },
    });
    const task = mockTask({
      description: 'notes',
      dueDate: '2026-02-01T00:00:00.000Z',
      priority: 'high',
      assignedTo: 'Alice',
      energyLevel: 'low',
      location: 'Kitchen',
      projectId: 'p1',
      areaId: 'a1',
      sectionId: 's1',
      tags: ['#work'],
      checklist: [{ title: 'Buy milk', done: true }, { title: 'Call mom' }],
      attachments: [{ id: 'a1', title: 'Invoice', uri: 'https://x/y.pdf' }],
      recurrence: { rule: 'weekly' },
    });
    const issue = await mapTaskToPluginIssue(task, { host: 'https://h' }, http);
    expect(issue.id).toBe('t1');
    expect(issue.title).toBe('Test task');
    expect(issue.body).toBe('notes');
    expect(issue.url).toBe('https://h/tasks/t1');
    expect(issue.state).toBe('next');
    expect(issue.assignee).toBe('Alice');
    expect(issue['priority']).toBe('high');
    expect(issue['energyLevel']).toBe('low');
    expect(issue['location']).toBe('Kitchen');
    expect(issue['project']).toBe('Home');
    expect(issue['area']).toBe('Personal');
    expect(issue['section']).toBe('Groceries');
    expect(issue['recurrenceLabel']).toBe('Weekly');
    expect(issue['checklistMarkdown']).toBe('- [x] Buy milk\n- [ ] Call mom');
    expect(issue['attachmentsMarkdown']).toBe('- [Invoice](https://x/y.pdf)');
    expect(issue['descriptionRaw']).toBe('notes');
    expect(issue['tagsLabels']).toEqual(['#work']);
    expect(issue['dueDateRaw']).toBe('2026-02-01T00:00:00.000Z');
  });

  it('shows focusedTodayLabel only when isFocusedToday is true', async () => {
    const http = mockHttp({});
    const focused = await mapTaskToPluginIssue(
      mockTask({ isFocusedToday: true }),
      { host: 'https://h' },
      http,
    );
    expect(focused['focusedTodayLabel']).toBe('Yes');

    const notFocused = await mapTaskToPluginIssue(
      mockTask({ isFocusedToday: false }),
      { host: 'https://h' },
      http,
    );
    expect(notFocused['focusedTodayLabel']).toBeUndefined();
  });

  it('omits dueDateRaw when isIgnoreDueDate is on', async () => {
    const http = mockHttp({});
    const issue = await mapTaskToPluginIssue(
      mockTask({ dueDate: '2026-02-01T09:00:00.000Z' }),
      { host: 'https://h', isIgnoreDueDate: true },
      http,
    );
    expect('dueDateRaw' in issue).toBe(false);
  });
});

describe('fetchTasks', () => {
  it('filters by projectsFilter client-side', async () => {
    const tasks = [
      mockTask({ id: 't1', projectId: 'p1' }),
      mockTask({ id: 't2', projectId: 'p2' }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', projectsFilter: ['p1'] },
      http,
    );
    expect(result).toEqual([tasks[0]]);
  });

  it('filters by areasFilter client-side', async () => {
    const tasks = [
      mockTask({ id: 't1', areaId: 'a1' }),
      mockTask({ id: 't2', areaId: 'a2' }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks('', { host: 'https://h', areasFilter: ['a1'] }, http);
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });

  it('passes isFocusedToday to the API and re-filters client-side', async () => {
    const tasks = [
      mockTask({ id: 't1', isFocusedToday: true }),
      mockTask({ id: 't2', isFocusedToday: false }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', onlyFocusedToday: true },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t1']);
    expect(http.get).toHaveBeenCalledWith(
      'https://h/v1/tasks',
      expect.objectContaining({ params: expect.objectContaining({ isFocusedToday: 'true' }) }),
    );
  });

  it('does not filter by focus when onlyFocusedToday is off', async () => {
    const tasks = [
      mockTask({ id: 't1', isFocusedToday: true }),
      mockTask({ id: 't2', isFocusedToday: false }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks('', { host: 'https://h' }, http);
    expect(result.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('unwraps a wrapped response', async () => {
    const tasks = [mockTask()];
    const http = mockHttp({ '/v1/tasks': { tasks } });
    const result = await fetchTasks('foo', { host: 'https://h' }, http);
    expect(result).toEqual(tasks);
  });

  it('filters by multiple selected statuses client-side ("anything but waiting")', async () => {
    const tasks = [
      mockTask({ id: 't1', status: 'inbox' }),
      mockTask({ id: 't2', status: 'waiting' }),
      mockTask({ id: 't3', status: 'next' }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', statusFilters: ['inbox', 'next', 'someday', 'reference'] },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('filters by tagsFilter/contextsFilter client-side (OR within each, AND across)', async () => {
    const tasks = [
      mockTask({ id: 't1', tags: ['#work'], contexts: ['@phone'] }),
      mockTask({ id: 't2', tags: ['#work'], contexts: ['@home'] }),
      mockTask({ id: 't3', tags: ['#personal'], contexts: ['@phone'] }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', tagsFilter: ['#work'], contextsFilter: ['@phone'] },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });

  it('excludes by projectsExclude/areasExclude client-side', async () => {
    const tasks = [
      mockTask({ id: 't1', projectId: 'p1', areaId: 'a1' }),
      mockTask({ id: 't2', projectId: 'p2', areaId: 'a1' }),
      mockTask({ id: 't3', projectId: 'p1', areaId: 'a2' }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', projectsExclude: ['p1'], areasExclude: ['a2'] },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t2']);
  });

  it('excludes by statusExcludes client-side', async () => {
    const tasks = [
      mockTask({ id: 't1', status: 'inbox' }),
      mockTask({ id: 't2', status: 'waiting' }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', statusExcludes: ['waiting'] },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });

  it('excludes by tagsExclude/contextsExclude client-side', async () => {
    const tasks = [
      mockTask({ id: 't1', tags: ['#work'], contexts: ['@phone'] }),
      mockTask({ id: 't2', tags: ['#personal'], contexts: ['@phone'] }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', tagsExclude: ['#work'] },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t2']);
  });

  it('exclude wins when the same value is checked in both include and exclude', async () => {
    const tasks = [
      mockTask({ id: 't1', projectId: 'p1' }),
      mockTask({ id: 't2', projectId: 'p2' }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      {
        host: 'https://h',
        projectsFilter: ['p1', 'p2'],
        projectsExclude: ['p1'],
      },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t2']);
  });

  it('does not exclude a task missing the excluded dimension (no project/area set)', async () => {
    const tasks = [
      mockTask({ id: 't1', projectId: undefined }),
      mockTask({ id: 't2', projectId: 'p1' }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const result = await fetchTasks(
      '',
      { host: 'https://h', projectsExclude: ['p1'] },
      http,
    );
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('loadTagOptions / loadContextOptions', () => {
  it('derives a sorted, deduped option list from a task sample', async () => {
    const tasks = [
      mockTask({ id: 't1', tags: ['#work', '#urgent'] }),
      mockTask({ id: 't2', tags: ['#work'] }),
    ];
    const http = mockHttp({ '/v1/tasks': tasks });
    const options = await loadTagOptions({ host: 'https://h', token: 'x' }, http);
    expect(options).toEqual([
      { label: '#urgent', value: '#urgent' },
      { label: '#work', value: '#work' },
    ]);
  });

  it('returns an empty list until host/token are configured', async () => {
    const http = mockHttp({});
    expect(await loadTagOptions({}, http)).toEqual([]);
    expect(await loadContextOptions({ host: 'https://h' }, http)).toEqual([]);
  });
});

describe('loadProjectOptions / loadAreaOptions', () => {
  it('lists projects from the dedicated endpoint, sorted by name', async () => {
    const http = mockHttp({
      '/v1/projects': [
        { id: 'p2', title: 'Work' },
        { id: 'p1', title: 'Home' },
      ],
    });
    const options = await loadProjectOptions({ host: 'https://h', token: 'x' }, http);
    expect(options).toEqual([
      { label: 'Home', value: 'p1' },
      { label: 'Work', value: 'p2' },
    ]);
  });

  it('lists areas from the dedicated endpoint', async () => {
    const http = mockHttp({ '/v1/areas': [{ id: 'a1', name: 'Personal' }] });
    const options = await loadAreaOptions({ host: 'https://h', token: 'x' }, http);
    expect(options).toEqual([{ label: 'Personal', value: 'a1' }]);
  });

  it('returns an empty list on failure rather than throwing', async () => {
    const http = mockHttp({});
    expect(await loadProjectOptions({ host: 'https://h', token: 'x' }, http)).toEqual([]);
  });
});

describe('createMindwtrTask', () => {
  it('POSTs the title and returns the created task, mapped as a PluginIssue', async () => {
    const created = mockTask({ id: 'new-1', title: 'Buy milk' });
    const http: PluginHttp = {
      get: vi.fn(),
      post: vi.fn(async () => created),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    };
    const result = await createMindwtrTask('Buy milk', { host: 'https://h' }, http);
    expect(http.post).toHaveBeenCalledWith('https://h/v1/tasks', { title: 'Buy milk' });
    expect(result.issueId).toBe('new-1');
    expect(result.issueData.title).toBe('Buy milk');
    expect(result.issueData.url).toBe('https://h/tasks/new-1');
  });
});

describe('updateMindwtrTask', () => {
  it('calls the complete endpoint when isDone pushes to done', async () => {
    const http = mockHttp({});
    await updateMindwtrTask('t1', { state: 'done' }, { host: 'https://h' }, http);
    expect(http.post).toHaveBeenCalledWith('https://h/v1/tasks/t1/complete', {});
  });

  it('does not call complete or patch for a state of "next" (reopen unsupported)', async () => {
    const http = mockHttp({});
    await updateMindwtrTask('t1', { state: 'next' }, { host: 'https://h' }, http);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.patch).not.toHaveBeenCalled();
  });

  it('patches title, description, timeEstimate, tags and dueDate when present', async () => {
    const http = mockHttp({});
    await updateMindwtrTask(
      't1',
      {
        title: 'New title',
        descriptionRaw: 'New notes',
        timeEstimateRaw: '30min',
        tagsLabels: ['#work'],
        dueDateRaw: '2026-02-01',
      },
      { host: 'https://h' },
      http,
    );
    expect(http.patch).toHaveBeenCalledWith('https://h/v1/tasks/t1', {
      title: 'New title',
      description: 'New notes',
      timeEstimate: '30min',
      tags: ['#work'],
      dueDate: '2026-02-01',
    });
  });

  it('sends no patch when changes contain nothing patchable', async () => {
    const http = mockHttp({});
    await updateMindwtrTask('t1', {}, { host: 'https://h' }, http);
    expect(http.patch).not.toHaveBeenCalled();
  });
});

describe('deleteMindwtrTask', () => {
  it('does nothing when deleteBehavior is unset (default)', async () => {
    const http = mockHttp({});
    await deleteMindwtrTask('t1', { host: 'https://h' }, http);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('does nothing when deleteBehavior is explicitly "none"', async () => {
    const http = mockHttp({});
    await deleteMindwtrTask('t1', { host: 'https://h', deleteBehavior: 'none' }, http);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('archives (not deletes) when deleteBehavior is "archive"', async () => {
    const http = mockHttp({});
    await deleteMindwtrTask(
      't1',
      { host: 'https://h', deleteBehavior: 'archive' },
      http,
    );
    expect(http.post).toHaveBeenCalledWith('https://h/v1/tasks/t1/archive', {});
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('calls DELETE /tasks/:id when deleteBehavior is "delete"', async () => {
    const http = mockHttp({});
    await deleteMindwtrTask(
      't1',
      { host: 'https://h', deleteBehavior: 'delete' },
      http,
    );
    expect(http.delete).toHaveBeenCalledWith('https://h/v1/tasks/t1');
    expect(http.post).not.toHaveBeenCalled();
  });
});
