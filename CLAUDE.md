# CLAUDE.md — Technical Reference

Context and reasoning for maintaining or extending this plugin, written to
stand alone — no prior conversation needed. If you're a user just trying to
install and configure the plugin, see `README.md` instead; this file is for
whoever (human or AI) next touches the code.

## What this is

A Super Productivity (SP) issue-provider plugin that connects to a
self-hosted MindWtr **Cloud Server** (`/v1/*` REST API — see
[docs.mindwtr.app/developers/cloud-api](https://docs.mindwtr.app/developers/cloud-api)).

**Not the desktop app's Local API.** MindWtr's desktop app also exposes a
Local API, enabled via Settings → Advanced → "Local API server" (default port
`3456`, bearer-token auth) — confirmed via
[docs.mindwtr.app/power-users/local-api](https://docs.mindwtr.app/power-users/local-api),
which states it's "intended to run on `127.0.0.1` (localhost)" with no
documented option to bind elsewhere. `PluginHttpService._validateUrl` (`plugin-http.service.ts`)
blocks any request to `localhost`/`127.0.0.1`/`::1`/`0.0.0.0` and RFC1918/link-local
ranges unless the caller passes `allowPrivateNetwork: true` — and
`plugin-bridge.service.ts`'s `_registerIssueProvider` computes that flag as
`issueProviderCfg?.allowPrivateNetwork && this._isPluginBundled(pluginId)`, where
`_isPluginBundled` checks the plugin's install path starts with
`assets/bundled-plugins/` (a fixed list baked into SP's own build,
`plugin.service.ts`). An uploaded plugin's path is `uploaded://…` (see
`plugin-management.component.ts`), which can never match that prefix — so
declaring `allowPrivateNetwork: true` in this plugin's own manifest would be a
silent no-op. There is no config, setting, or manifest permission that lifts
this for an installed plugin.

That said, this is enforced by `PluginHttpService`, the sanctioned HTTP path —
it is not an execution sandbox. `PluginRunner._executePlugin` runs `plugin.js`
via `new Function('plugin', 'PluginAPI', code)` in the renderer's own JS realm
(confirmed by reading `plugin-runner.ts`; `plugin-security.ts` says so
explicitly: "plugin iframes are same-origin on purpose, so a hostile plugin
never needed this sink"). Nothing at the platform level stops plugin code from
calling `fetch()`/`XMLHttpRequest` directly instead of going through
`PluginHttpService`, which would bypass this check entirely. This plugin never
does that — doing so would circumvent SP's stated security boundary rather than
use a supported integration path, and is out of scope for a legitimate
provider. So for this plugin, as built, localhost is unreachable; the
guarantee comes from staying on the sanctioned API, not from an unbypassable
sandbox.

So this plugin targets the Cloud Server, which is meant to be reachable over a
real network, instead.

## Architecture: one plugin, not two

The design intentionally does **not** include a second "template" or
"timeblock" plugin. Reasoning:

- MindWtr is treated as the master task list. Tasks import into SP as
  **linked, synced** tasks (pull by default; push is available per field).
- SP's built-in **Duplicate Task** (`TaskDuplicateService.duplicate()`)
  already produces a clean, disconnected working copy: its output is built
  from an explicit field whitelist (`isDone`, `projectId`, `tagIds`,
  `notes`, `dueDay`/`dueWithTime`/`timeEstimate`) that excludes
  `issueId`/`issueProviderId`/`issueType` entirely — verified by reading the
  function directly, not inferred. So duplicating a linked task already
  gives a completely independent copy with no plugin code needed.
- The intended flow: import → the linked copy sits wherever you put it
  (e.g. backlog) as a live mirror → Duplicate Task when you're ready to
  actually work on something → the duplicate is fully free to reschedule,
  re-estimate, and complete without any sync interaction at all.

## MindWtr's real data shapes (verified from source, not docs)

MindWtr's own documentation is incomplete or occasionally silent on exact
field shapes. Where that happened, the actual source
(`github.com/dongdongbh/Mindwtr`, `packages/core/src/types.ts` and
`packages/core/src/task-sync-schema.ts`) was read directly:

- **`timeEstimate`** is not a plain number. It's a preset string
  (`'5min'|'10min'|'15min'|'30min'|'1hr'|'2hr'|'3hr'|'4hr'|'4hr+'`) or a
  `custom:<N>` string. The unit of `N` in the custom form is *not*
  documented or confirmed anywhere in MindWtr's own code — every preset
  sibling is minute/hour-scale, so it's assumed to mean minutes.
  `timeEstimateToMs` / `msToTimeEstimate` in `src/mindwtr-api.ts` is the one
  place to fix this if a custom estimate ever imports with an obviously
  wrong duration.
- **`recurrence`** is `Recurrence | RecurrenceRule`, where
  `RecurrenceRule = 'daily' | 'weekly' | 'monthly' | 'yearly'` and
  `Recurrence` is an object whose base cadence is still `.rule`, plus
  optional `until`/`count`/`rrule`/etc. `formatRecurrenceLabel` handles
  both shapes. This can only ever be a display field — `recurrence` isn't
  in SP's plugin-syncable field set (see below), and SP's own recurring-task
  system (`TaskRepeatCfg`) is a separate, more elaborate concept the plugin
  API doesn't expose at all.
- **All-day vs. timed due dates**: MindWtr's desktop date-picker
  (`apps/desktop/src/components/InboxProcessingScheduleFields.tsx`) has a
  `hasTime`/`onDateOnly` toggle. Picking a date with no specific time writes
  a bare `'yyyy-MM-dd'` string, not a full timestamp — so the signal for
  "all-day" is the **shape of the `dueDate` string itself**, not a separate
  flag. `isAllDayDateString()` checks for exactly `^\d{4}-\d{2}-\d{2}$`.
  **Unverified:** this is confirmed in the desktop app's local editing UI;
  whether the *Cloud API* preserves the same distinction when serializing
  `dueDate` to JSON (versus normalizing everything to a full timestamp) has
  not been confirmed against a live server. If all-day MindWtr tasks import
  with a specific time attached, this is the check to revisit.
- **No comments/thread concept** exists on MindWtr tasks at all (checked
  the source for `comment`, `thread`, `activity` — nothing). `description`
  is the only free-text field. So `commentsConfig` (a real capability of
  SP's plugin API) is correctly left unimplemented — there's nothing to
  wire it to, not an oversight.

## SP mechanics that were traced (not assumed)

These behaviors live in SP's own source, not this plugin, and were
confirmed by reading the code directly (paths relative to SP's repo root):

- **A field mapping's creation-time seed is unconditional.**
  `plugin-issue-provider-adapter.service.ts`'s
  `_extractTaskFieldsFromIssueWithSyncValues` applies every declared
  `fieldMappings` entry once at task creation regardless of that field's
  configured sync direction. So setting a field's sync direction to "Off"
  only stops *later* polls — it does not prevent the very first import from
  picking up a value. This is why `isIgnoreDueDate` had to be a separate
  plugin-level setting rather than something achievable via the standard
  per-field dropdown: it suppresses the `dueDateRaw` key entirely (not just
  nulls it), so the `toTaskValue` for `dueDay`/`dueWithTime` never even
  runs (`if (issueValue == null) continue`), covering both the seed and all
  later polls.
- **A timed due date bypasses the backlog entirely.**
  `issue.service.ts`'s `addTaskFromIssue`:
  ```js
  taskId = taskData.dueWithTime
    ? await this._taskService.addAndSchedule(title, taskData, taskData.dueWithTime)
    : this._taskService.add(title, isAddToBacklog, taskData);
  ```
  `isAddToBacklog` is ignored completely whenever the task has a
  `dueWithTime`. Only tasks with no due date, or an all-day-only one, ever
  actually land in the backlog when that setting is on. This is exactly why
  the `Ignore Due Date` setting exists — without it, any MindWtr task with a
  timed due date gets scheduled directly regardless of the backlog setting.
- **Plugin providers poll everything, regardless of `pollingMode`.**
  `poll-issue-updates.effects.ts`'s `_getTasksForProvider`: any plugin-based
  provider (matched via `isPluginIssueProvider`) always polls all of its
  tasks across all projects — the "current work context only" scoping only
  applies to built-in providers. So `pollingMode` doesn't restrict *what*
  gets checked for this plugin, only *when*. With the default
  `pollingMode: 'whenProjectOpen'`, the poll timer restarts on every
  project/tag switch (`switchMap` on `setActiveWorkContext`) and only fires
  after sitting idle for a full interval — frequent navigation can prevent
  it from ever completing. `pollingMode: 'always'` avoids this.
- **Deletion and creation only reach the plugin if it declares the
  corresponding hook, and the host does the linking.**
  `plugin-sync-adapter.service.ts`: `deleteIssue: definition.deleteIssue ?
  ... : undefined`, and the effect that would call it bails immediately
  otherwise (`if (!adapter?.deleteIssue) return EMPTY`). Same pattern for
  `createIssue`. When `createIssue` succeeds, the host immediately links
  the local task to the new MindWtr id
  (`this._taskService.update(task.id, { issueId, issueType, issueProviderId,
  ... })`) — it's a one-shot "create remotely + link back," not an orphaned
  local task that could get duplicated by a later import.
- **`createIssue`'s real risk is unwanted linking, not duplication**, and
  it's specific to anyone using both Default Project and Duplicate Task
  together. The trigger condition
  (`issue-two-way-sync.effects.ts`, `autoCreateIssueOnTaskAdd$`):
  ```js
  filter(({ task }) => !task.issueId && !task.parentId && !!task.projectId),
  providers.find(p => p.defaultProjectId === task.projectId && hasAutoCreateEnabled(p))
  ```
  fires for *any* new, unlinked task landing in the provider's Default
  Project — and `TaskDuplicateService.duplicate()` copies `projectId` from
  the original onto the duplicate. So if a provider's Default Project is
  the same project Duplicates land in, turning on "Auto-create issues"
  would silently push every duplicate to MindWtr as a new task and re-link
  it, defeating the point of duplicating. This can't be safely defaulted
  around by the plugin — it depends on the user's own project setup.
- **`isDone` can only push `true`.** MindWtr has no PATCH-able transition
  into "done" — completion is only reachable via the dedicated
  `POST /tasks/:id/complete` endpoint (MindWtr's docs: "cannot reopen
  done/archived tasks via PATCH"). There's no documented way to push a
  reopen at all, so that direction is silently skipped in `updateIssue`.
- **Archive over delete, deliberately.** MindWtr's docs group `/restore`
  alongside `/complete` and `/archive` as "dedicated endpoints for terminal
  operations," implying `/restore` undoes either — so archiving is
  confirmed-reversible. Raw `DELETE /tasks/:id`'s recoverability for tasks
  specifically is never confirmed (only that projects/areas/sections use
  tombstones, and that a `deleted=1` list param exists for tasks too, which
  suggests but doesn't confirm the same). Hence the three-way **Delete
  Behaviour** setting (None/Archive/Delete) rather than a single checkbox —
  "soft" and "hard" delete are different risk levels, not a phrasing choice.
- **`_computeIsDone` reads `.state`, not `.status`, even at creation time**
  on the object SP treats as a `PluginIssue`. So `mapSearchResult` (used for
  search/backlog-import) sets both `status` (the recognized
  `PluginSearchResult` field) and `state` (what `_computeIsDone` actually
  reads) to the same value — otherwise a MindWtr task that's already done
  at import time would import as not-done.
- **Checkbox fields render with a misleading "indeterminate" (dash) icon
  by default**, unrelated to the actual stored value. `@ngx-formly/material`'s
  checkbox type ships `indeterminate: true` as a baked-in default prop, and
  SP doesn't override it anywhere for config-form checkboxes (confirmed via
  grep — this affects built-in providers' checkboxes too, not just plugin
  ones). The underlying value is still correctly `undefined`/falsy for an
  unset field; the dash is purely cosmetic and clears (to *checked*, not
  unchecked — a Material quirk) on first click. Not fixable from the plugin
  side — `PluginFormField` has no `indeterminate` override to set.

## Include/exclude filters

Every "…to include" search/backlog-import filter (Projects, Areas, Statuses,
Tags, Contexts) has an "…to exclude" counterpart with the same option list.
Both are applied client-side in `fetchTasks` (`mindwtr-api.ts`), includes
first, excludes last, as separate sequential narrowing passes over the same
`tasks` array — not merged into one combined predicate. That ordering is
what makes exclude win whenever a value is checked in both an include list
and its exclude counterpart: the include pass keeps it, the exclude pass
then removes it, with no special-cased conflict handling needed.

**Nothing prevents a value from being checked in both.** The plugin config
API has no mechanism for one field to disable specific options in another
field based on its current value — `showIf` (see `plugin-issue-provider.model.ts`
`PluginFormField`) only shows/hides a field *as a whole*, and `_mapPluginConfigField`
on the host side forwards a fixed property whitelist (`key, type, label,
required, description, url, pattern, options, showIf, loadOptions`) with
nothing resembling per-option cross-field disabling. So this is solved by
exclude-wins-on-overlap ordering rather than by preventing the double-check
in the UI — there was no API-level way to do the latter.

A task missing the relevant dimension entirely (no `projectId`, no
`areaId`) is never excluded by that dimension's exclude filter — mirrors
how the include filter already treats a task missing the dimension (an
include filter excludes it for having nothing to match; an exclude filter
has nothing to match either, so it passes through). See the "exclude wins"
and "missing dimension" tests in `mindwtr-api.test.ts`'s `fetchTasks` suite.

## Field mapping

SP's plugin API allows syncing exactly seven task fields — this is a fixed
set from `packages/plugin-api/src/issue-provider-types.ts`'s
`PluginFieldMapping.taskField` union: `isDone | title | notes | dueDay |
dueWithTime | timeEstimate | tagIds`. Nothing else can ever become a real,
two-way-syncable SP field via a plugin, no matter how the API evolves in
other ways — this plugin uses all seven.

| MindWtr field | → SP field | issueField key |
| --- | --- | --- |
| `status` | `isDone` | `state` |
| `title` | `title` | `title` |
| `description` | `notes` | `descriptionRaw` |
| `tags` (never `contexts`/`areaId`) | `tagIds` | `tagsLabels` |
| `dueDate` (bare `YYYY-MM-DD`) | `dueDay` | `dueDateRaw` |
| `dueDate` (full timestamp) | `dueWithTime` | `dueDateRaw` |
| `timeEstimate` | `timeEstimate` | `timeEstimateRaw` |

All seven default to `pullOnly`. SP auto-generates a per-field
Off/Pull/Push/Both dropdown in the provider's edit dialog for every entry
in `fieldMappings` — nothing here is hardcoded to one direction.

Two more checkboxes appear in the provider's edit dialog purely as a side
effect of declaring these fields — not declared by this plugin's own `CFG`,
and not mentioned in `README.md` since they're generic SP mechanics, not
MindWtr-specific ones (`dialog-edit-issue-provider.component.ts`):
- **"Auto-create issues"** (`pluginConfig.isAutoCreateIssues`) appears because
  `createIssue` is implemented; disabled until Default Project is set. This
  one *is* MindWtr-specific in effect (it triggers this plugin's own
  `createIssue`), so it's documented in the README's settings table.
- **"Auto-create tags for synced labels"** (`pluginConfig.isAutoCreateTags`)
  appears because `fieldMappings` includes `tagIds`. Fully generic — creates a
  local SP tag when an unknown label is pulled, unrelated to any MindWtr-specific
  code in this plugin. Off by default.

**Why only `tags`, never `contexts` or `areaId`, feed `tagIds`:** a field
mapping's push (`toIssueValue`) can only write into one MindWtr field. If
tags, contexts, and area were all blended into one combined set and pushed,
there'd be no way to unmix it on the way back — a context like `@phone` or
an area name would get PATCHed into MindWtr's real `tags` array as a fake
tag. `areaId` is additionally a poor fit regardless of push direction: it's
an id reference to a real MindWtr resource, not a free-form label. So
`contexts` and `areaId` stay display-only.

**Why `dueDay` and `dueWithTime` share one `issueField`
(`dueDateRaw`):** each mapping's `toTaskValue` checks the string shape and
only returns a value if it matches (all-day → `dueDay`'s mapping fires;
timestamp → `dueWithTime`'s does), so exactly one of the two ever produces a
value for a given task — no conflict, and both directions (pull and push)
naturally resolve correctly since a task only ever has one of `dueDay` /
`dueWithTime` set.

**`projectId`/`project` was never at risk of an SP/MindWtr conflation
through sync** — it simply isn't in the seven-field list a plugin can map
at all. "Default Project" (where imports land) is a separate, generic
per-provider *setting* every issue provider gets from the host
(`ISSUE_PROVIDER_COMMON_FORM_FIELDS`), not a per-task sync.

## Display-only fields

SP has no native field for these at all — this is a hard ceiling in SP's
data model, not something more plugin code could close:

`priority`, `energyLevel`, `assignedTo`, `startTime`, `location`,
`checklist` (rendered as a markdown checklist), `attachments` (rendered as
markdown links), `projectId`/`areaId`/`sectionId` (each resolved to a real
name via `GET /v1/projects/:id`, `/v1/areas/:id`, `/v1/sections/:id`, cached
per session, falling back to the raw id on failure), `isFocusedToday`,
`recurrence`.

## `deletedStates`

Declared as `['archived']` (not `'done'` — that's a real completion,
already correctly handled by the `isDone` mapping). Tells SP that an issue
whose MindWtr status becomes `archived` should be treated as remotely gone
(SP's normal remote-deletion flow — warns if time was tracked, etc.)
instead of erroring on a 404 from the next poll. This is a static
declaration read once from the provider definition — there's no way to gate
it behind a per-instance setting, unlike everything else in this plugin.

## Genuinely not implemented, and why

- **Checklist items as real SP sub-tasks.** The plugin API's
  `IssueProviderPluginDefinition` has no `getSubTasks` hook — only SP's
  built-in (non-plugin) providers have that capability. Structural gap, not
  a missing setting.
- **`timeSpentMinutes` push or pull.** Traced the actual sync code
  (`_extractTaskFieldsFromIssueWithSyncValues` and the push-loop in
  `issue-two-way-sync.effects.ts`) — the push payload is built *exclusively*
  from the plugin's own declared `fieldMappings` array, and `timeSpent`
  isn't a valid `taskField` and never can be. The only path would be a
  separate, non-declarative hook (`ANY_TASK_UPDATE`) plus a manual PATCH
  call — deliberately left out to keep this plugin's behavior fully
  declarative and consistent.
- **`timeBlock` (upsert/delete calendar event)** — a real plugin
  capability, meant for providers backing an external calendar (e.g. Google
  Calendar), where scheduling a task in SP should create a matching
  calendar event elsewhere. Not applicable here: MindWtr tasks aren't
  separate calendar-event resources, and what this would push (a due time)
  is already covered by the `dueDay`/`dueWithTime` mapping's push direction.
- **OAuth.** MindWtr's Cloud API uses a plain bearer token — no OAuth flow
  to wire up.

## Unverified assumptions — check these against a real server

Everything else in this plugin was confirmed against MindWtr's actual
source or SP's actual source. These specific points could not be verified
without a live Cloud Server and are worth testing for:

1. Whether `GET /v1/tasks`'s `dueDate` actually preserves the
   all-day-vs-timestamp string distinction (see above), or normalizes
   everything to a full timestamp.
2. The unit of `custom:<N>` in `timeEstimate` (assumed minutes).
3. Whether `GET /v1/tasks` returns a bare array or a wrapped object —
   handled defensively either way (`unwrapList` checks several common
   wrapper key names), so low risk regardless.
4. Whether `isFocusedToday=true` actually filters server-side — also
   re-checked client-side as a safety net, so low risk regardless.
5. Whether archive/delete are actually recoverable for tasks specifically
   (the docs only confirm tombstone behavior for projects/areas/sections).

## Development

```
npm install
npm run typecheck
npm test
npm run build          # writes dist/
```

To produce the installable zip:

```
cd dist
zip -r ../sp-mindwtr-sync.zip manifest.json plugin.js icon.svg i18n
```

Types in `src/plugin-api-types.ts` are vendored (copied by hand, not
imported) from SP's `packages/plugin-api/src/issue-provider-types.ts`,
because the published `@super-productivity/plugin-api` npm package (as of
1.0.1) doesn't yet re-export the issue-provider types — only SP's own
monorepo copy does. These are type-only (erased by esbuild at build time),
so there's no runtime coupling; update this file by hand if SP's real
package shape changes. Do not add a dependency on SP's source tree to build
this plugin — the whole point of vendoring is that this plugin needs
nothing beyond its own `src/` and `node_modules`.

## Release automation

`.github/workflows/ci.yml` runs `typecheck`/`test`/`build` on every push and
PR to `main`. `.github/workflows/release.yml` triggers on pushing a `v*` tag:
it rebuilds, verifies the tag's version matches `package.json`'s (fails the
release rather than publishing a mismatched artifact), zips `dist/` the same
way the manual instructions above do, and attaches
`sp-mindwtr-sync.zip` to a GitHub Release via
`softprops/action-gh-release` with auto-generated release notes. Cutting a
release is then: bump the version in `package.json` and `src/manifest.json`,
commit, tag `vX.Y.Z`, push the tag.

This pattern (and the flat zip structure — `manifest.json`, `plugin.js`,
`icon.svg`, `i18n/` at the zip root, no wrapping folder) was cross-checked
against other community SP issue-provider/plugin repos before writing it:
`b0x42/Super-Productivity-MCP` has the closest-matching CI+tag-triggered
release setup (same shape, reused here almost directly) and its release
zip's contents were downloaded and inspected directly; `CuriousChipmunk/
vision-board-super-productivity` and `baiyina/Archived-Tasks-Viewer` also
ship flat zips via GitHub Releases, confirming this is the norm, but build
those releases by hand rather than via CI. `organicmoron/SP-MCP` commits a
`plugin.zip` straight into the repo instead of using Releases at
all — noted as the pattern to avoid: nothing forces that committed zip to
stay in sync with the source next to it.

No git repository exists yet for this plugin (as of this writing) — these
workflows are ready but inert until the project is pushed to GitHub.

**Note for a future agent:** this repo currently has no git history and no
remote. Before assuming a GitHub repo/URL exists for this plugin, or that a
release has ever been cut, verify with `git remote -v` and `git tag` (or
their absence) rather than trusting anything written here about where it
lives — that's exactly the kind of fact that goes stale.

## Community plugins listing (not done yet — reference only)

SP's in-app plugin browser (Settings → Plugins → "Community Plugins" tab)
reads its list from `src/assets/community-plugins.json` in SP's own repo
(`super-productivity/super-productivity`) — read directly to confirm the
schema. Each entry is just:

```json
{
  "name": "Display Name",
  "shortDescription": "One sentence.",
  "url": "https://github.com/<owner>/<repo>",
  "author": "<owner>",
  "authorUrl": "https://github.com/<owner>",
  "stars": 0
}
```

Confirmed by reading `plugin-management.component.ts`/`.html`: the app does
**not** fetch or auto-install anything from `url` — it's purely a card with
an outbound link plus a star count. No packaging format is enforced by SP
itself; a listed repo could point at nothing installable and SP wouldn't
know. `stars` also isn't live-fetched — whatever number is in the JSON at
merge time is what displays, so it goes stale until someone submits an
update.

To submit: open a PR against `super-productivity/super-productivity` adding
an entry to that JSON array (alphabetical-ish, but not strictly enforced —
existing entries aren't sorted). Do this once the plugin has its own repo, a
tagged release, and has seen some real use — not before.
