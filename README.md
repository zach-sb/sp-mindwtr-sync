# MindWtr Issue Provider for Super Productivity

> **⚠️ Vibecoded.** This plugin was written with [Claude](https://claude.com/claude-code)
> rather than hand-written. It's tested (unit tests, typecheck, manual use)
> but hasn't had a human security or code review — use accordingly.

Import and sync tasks from [MindWtr](https://github.com/dongdongbh/Mindwtr)
into [Super Productivity](https://super-productivity.com/).

## Requirements

This plugin needs a network-reachable **MindWtr Cloud Server** — not the
desktop app's Local API. Super Productivity blocks every installed plugin
from reaching `127.0.0.1`, `localhost`, and private-network addresses
entirely (a bare LAN IP included), with no setting — in this plugin or in
Super Productivity — that lifts that block. So whatever the Host is set to,
it has to be a real, non-private network address.

The Cloud Server is MindWtr's separate, self-hosted sync service with its
own `/v1/*` REST API. You need one deployed and running; the plugin's Host
and API Token settings point at it. See
[docs.mindwtr.app/developers/cloud-api](https://docs.mindwtr.app/developers/cloud-api)
and [docs.mindwtr.app/data-sync/self-hosted-cloud](https://docs.mindwtr.app/data-sync/self-hosted-cloud).

## Install

```
npm install
npm run build
```

This produces `dist/`. Zip its contents (not the folder itself) into a flat
archive:

```
cd dist
zip -r ../sp-mindwtr-sync.zip manifest.json plugin.js icon.svg i18n
```

In Super Productivity: **Settings → Plugins → Choose Plugin File**, pick the
zip. Then add MindWtr as an issue provider and fill in your Cloud Server's
**Host** and **API Token**.

## Settings reference

| Setting | What it does |
| --- | --- |
| Host / API Token | Your MindWtr Cloud Server address and access token |
| Projects to include / Areas to include | Search and backlog-import only consider tasks from the checked ones. Leave empty for no filter. Doesn't affect a task already imported. |
| Projects to exclude / Areas to exclude | Search and backlog-import skip tasks from the checked ones, even if also checked in the matching "to include" list above. Leave empty for no filter. Doesn't affect a task already imported. |
| Statuses to include | Search and backlog-import only consider Inbox/Next/Waiting/Someday/Reference tasks you check. Leave empty for all. Doesn't affect a task already imported. |
| Statuses to exclude | Search and backlog-import skip the checked statuses, even if also checked in Statuses to include. Leave empty for no filter. Doesn't affect a task already imported. |
| Tags to include / Contexts to include | Search and backlog-import only consider tasks carrying at least one checked tag (if any are checked) and at least one checked context (if any are checked). Leave empty for no filter. Doesn't affect a task already imported. |
| Tags to exclude / Contexts to exclude | Search and backlog-import skip a task carrying any checked tag, and separately skip a task carrying any checked context, even if also checked in the matching "to include" list above. Leave empty for no filter. Doesn't affect a task already imported. |
| Only tasks focused for today | Off by default. Search and backlog-import only consider tasks MindWtr has explicitly marked focused-for-today. Doesn't affect a task already imported. |
| Ignore Due Date | Off by default. When on, MindWtr's due date is never applied to the linked task. |
| Web App URL | Optional. When set, "Open Issue" opens this URL instead of the task's raw data — either way, the app or the data, not a link to the specific task. |
| Delete Behaviour | None (default) / Archive / Delete. Controls what happens in MindWtr when the linked task is deleted in Super Productivity: None leaves MindWtr untouched, Archive archives the MindWtr task, Delete deletes it. |
| Auto-create issues | Off by default, only available once a Default Project is set. When on, a new task you create in that project is pushed to MindWtr as a new task. |

## What doesn't sync

- Checklist items don't become separate sub-tasks — they show as a
  checklist in the task's details.
- Time actually spent isn't pushed back to MindWtr.
- Recurrence is shown as information, not editable from Super Productivity.

See `CLAUDE.md` for the full technical reference, including every design
decision, what's been verified against MindWtr's real behavior versus still
assumed, and how to extend this plugin further.
