---
title: 'Deploy Page — 3-Step Deploy, Detect, Configure & Update Flow'
slug: 'deploy-page-v2'
created: '2026-03-21'
updated: '2026-03-22'
status: 'implemented'
stepsCompleted: [1, 2, 3, 4]
---

# Tech-Spec: Deploy Page — 3-Step Deploy, Detect, Configure & Update Flow

**Created:** 2026-03-21 | **Updated:** 2026-03-22

## Overview

### Problem Statement

Users need a browser-based way to deploy, configure, update, and manage Google
Apps Script projects from this repository. The deploy page must detect
previously deployed scripts (across browsers/devices), show their version
status, and provide inline configuration for all 3 scripts without requiring
users to manually edit `config.gs` in the Apps Script editor.

### Solution

A single-page HTML app (`deploy/index.html`) with a 3-step flow:

1. **Sign In** — authenticate, detect existing projects via Drive API
2. **Deploy** — select scripts and deploy (or re-deploy/update)
3. **Configure** — inline config forms for each deployed script, with save, update, and delete actions

## Functional Requirements by Step

### Step 1: Sign In with Google

**FR-1.1**: Sign-in button authenticates via Google Identity Services (GIS).

**FR-1.2**: OAuth scopes requested:

| Scope               | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `script.projects`   | Create/update Apps Script projects       |
| `calendar.readonly` | List user's calendars for config pickers |
| `drive`             | Detect existing projects, trash/delete   |
| `email`             | Get signed-in user's email for defaults  |

**FR-1.3**: After successful sign-in:

- Show "Signed in" indicator with checkmark
- Fetch user email via userinfo API (for config defaults)
- Fetch user's calendar list via Calendar API (for calendar pickers)
- **Search Google Drive for existing Apps Script projects** matching the
  `Petry-Projects – {name}` naming convention
- Show Step 2

**FR-1.4**: Step 2 is **hidden** until sign-in completes.

**FR-1.5**: If existing projects are found in Drive:

- Show "Deployed" badge on each detected script in Step 2
- Show Step 3 with Configure/Update/Delete buttons for each
- Fetch each project's content to read `// @version` tag
- Compare deployed version against catalog version
- Show "Update available" badge (amber) if outdated, "Deployed" (green) if current

**FR-1.6**: If no existing projects are found, Step 3 stays hidden.

### Step 2: Choose Scripts & Deploy

**FR-2.1**: Checkbox list of all scripts in `SCRIPT_CATALOG`.

**FR-2.2**: Each script shows:

- Name, description
- **"Deployed"** badge (green) if current version detected via Drive
- **"Update available"** badge (amber) if outdated version detected
- No badge if not deployed

**FR-2.3**: Deploy button is **inside the Step 2 card** (not a separate section).

**FR-2.4**: Deploy button state:

- Disabled until: signed in AND at least one script checked
- Label changes contextually:
  - "Deploy to my account" — when selecting undeployed scripts
  - "Re-deploy to my account" — when selecting only deployed scripts
  - "Update & Deploy to my account" — when selecting scripts with updates available

**FR-2.5**: On deploy:

1. Fetch `code.gs` and `config.gs` from GitHub (`GITHUB_RAW_BASE`)
2. Create new Apps Script project via API (or reuse existing via localStorage idempotency)
3. Upload files: `appsscript.json` manifest + `setup.gs` (hourly trigger) + `code.gs` + `config.gs` (template defaults)
4. Store `catalogId → scriptId` mapping in localStorage for redeploy idempotency
5. Show success status with project links
6. Show Step 3 with Configure buttons for newly deployed scripts

**FR-2.6**: `config.gs` is uploaded with **template defaults** during deploy. User customization happens in Step 3.

**FR-2.7**: All scripts use an **hourly trigger** in `setup.gs`. Schedule logic (weekly day/time, every-N-days) lives in `config.gs` and is checked at runtime by `code.gs`.

### Step 3: Configure Your Scripts

**FR-3.1**: Appears after:

- Successful deploy (for newly deployed scripts), OR
- Sign-in when existing projects detected via Drive API

**FR-3.2**: Shows one card per deployed script with:

- Script title + version info (e.g., `v1.0.0 ✓` or `v0.9.0 → v1.0.0`)
- "Open in Apps Script" link
- **[Update]** button — visible only when version is outdated
- **[Configure]** button — expands inline config form
- **[Delete]** button — trashes the project in Google Drive

**FR-3.3**: **Update** button behavior:

- Fetches latest `code.gs` from GitHub
- GETs current project content from Apps Script API
- Replaces only `code.gs` (and `setup.gs`), **preserving user's `config.gs`**
- PUTs updated content back
- Re-checks version after update; hides Update button if now current

**FR-3.4**: **Configure** button toggles an inline form. The form includes:

- Script-specific config fields (see below)
- **[Save Configuration]** button
- Save mechanism: build customized `config.gs` string → GET project content → replace config file → PUT back

**FR-3.5**: **Delete** button behavior:

- Confirmation dialog ("Are you sure?")
- Trashes the file via Drive API (`PATCH /files/{id}` with `{trashed: true}`)
- Removes card from UI, clears from local state and localStorage
- Hides Step 3 if no cards remain
- Refreshes Step 2 badges

**FR-3.6**: After saving config, shows **"Run setup()"** CTA:

- Instructions to open script in Apps Script editor and run `setup()`
- "Done — I ran setup()" confirmation button (persisted in localStorage)

#### Calendar to Briefing Doc Config Fields

| Field                | Type                                        | Required | Default              |
| -------------------- | ------------------------------------------- | -------- | -------------------- |
| Calendars to include | Multi-select checkboxes (from Calendar API) | No       | All checked          |
| Send briefing to     | Text (email)                                | Yes      | Signed-in user email |
| Email subject        | Text                                        | No       | "Weekly Briefing"    |
| Frequency            | Select: Weekly / Every N days               | No       | Weekly               |
| Day (if weekly)      | Select: Sun–Sat                             | No       | Monday               |
| Interval (if N days) | Select: 1,2,3,5,7,14                        | No       | 1                    |
| At approximately     | Select: all 24 hours (12 AM–11 PM)          | No       | 7 AM                 |
| Look ahead days      | Select: 3,5,7,10,14,30                      | No       | 7                    |

Timezone displayed as help text below the time field.

#### Gmail to Drive By Labels Config Fields

| Field           | Type | Required | Default |
| --------------- | ---- | -------- | ------- |
| Trigger label   | Text | Yes      | —       |
| Processed label | Text | Yes      | —       |
| Google Doc ID   | Text | Yes      | —       |
| Drive Folder ID | Text | Yes      | —       |

Help text: links to create a new Doc / find folder ID.

#### Calendar to Sheets Config Fields

| Field          | Type                               | Required | Default  |
| -------------- | ---------------------------------- | -------- | -------- |
| Calendar       | Select (from Calendar API) or text | Yes      | Primary  |
| Spreadsheet ID | Text                               | Yes      | —        |
| Sheet name     | Text                               | No       | "Sheet1" |

## Versioning

### Version Tag Format

Each script's `code.gs` contains a version tag as the first line:

```
// @version X.Y.Z
```

### Version Detection Flow

1. `loadExistingDeployments()` finds projects via Drive API
2. For each found project, `checkProjectVersion()` fetches content
3. `parseDeployedVersion()` extracts `@version` tag from `code.gs`
4. Compares against `SCRIPT_CATALOG[].version`
5. Updates UI: badge in Step 2, version info + Update button in Step 3

### SCRIPT_CATALOG

```javascript
const SCRIPT_CATALOG = [
  { id: 'gmail-to-drive-by-labels', name: '...', version: '1.0.0', ... },
  { id: 'calendar-to-sheets',       name: '...', version: '1.0.0', ... },
  { id: 'calendar-to-briefing-doc', name: '...', version: '2.0.0', ... },
]
```

### Update Process

The Update button in Step 3:

1. Fetches latest `code.gs` (with new `@version`) from GitHub
2. GETs current project files from Apps Script API
3. Replaces `code.gs` and `setup.gs`; preserves `config.gs` and `appsscript.json`
4. PUTs updated files back
5. Re-runs version check to confirm update succeeded

## Technical Architecture

### State Management

| State                 | Storage      | Purpose                                                   |
| --------------------- | ------------ | --------------------------------------------------------- |
| `accessToken`         | JS variable  | OAuth token for API calls                                 |
| `userEmail`           | JS variable  | Default email for config forms                            |
| `userCalendars`       | JS variable  | Calendar list for pickers                                 |
| `deployedScripts`     | JS Map       | catalogId → {scriptId, title}                             |
| `scriptVersions`      | JS Map       | catalogId → {deployedVersion, latestVersion, needsUpdate} |
| `renderedConfigCards` | JS Map       | catalogId → scriptId (dedup rendering)                    |
| Deploy mapping        | localStorage | catalogId+title → scriptId (idempotency)                  |
| Setup confirmation    | localStorage | scriptId → boolean                                        |

### API Dependencies

| API             | Endpoint                            | Purpose                  |
| --------------- | ----------------------------------- | ------------------------ |
| Google Identity | OAuth 2.0 token flow                | Authentication           |
| Drive v3        | `GET /files?q=...`                  | Detect existing projects |
| Drive v3        | `PATCH /files/{id}`                 | Trash/delete projects    |
| Apps Script     | `POST /projects`                    | Create new projects      |
| Apps Script     | `GET /projects/{id}/content`        | Read project files       |
| Apps Script     | `PUT /projects/{id}/content`        | Upload/update files      |
| Calendar v3     | `GET /users/me/calendarList`        | List user's calendars    |
| OAuth2 v2       | `GET /userinfo`                     | Get user's email         |
| GitHub Raw      | `GET /{branch}/src/{script}/{file}` | Fetch latest source      |

### Error Handling

- All API calls go through `apiFetch()` which extracts error messages from JSON responses
- `saveConfig()` and `updateScript()` show detailed error blocks with copyable text
- `loadExistingDeployments()` and `checkProjectVersion()` fail silently (non-critical)
- `deleteScript()` requires confirmation dialog before proceeding

## Test Coverage

- **291 unit tests** (Jest) — all script logic
- **64 Playwright E2E tests** — deploy page UI, flows, API mocking
- Tests cover: page structure, sign-in, deploy flow, config forms for all 3 scripts,
  version detection, Step 2/3 state transitions, error handling, multi-script deploy,
  idempotency, badge rendering

## Out of Scope

- Real-time validation of Doc IDs, Folder IDs, or Spreadsheet IDs
- Multi-user / team deployment flows
- Automatic trigger activation (user must run `setup()` manually)
- Undo/restore for deleted projects (user can restore from Drive Trash)
