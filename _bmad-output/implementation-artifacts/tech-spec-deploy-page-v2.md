---
title: 'Deploy Page — Post-Deploy Configuration Flow'
slug: 'deploy-page-v2'
created: '2026-03-21'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
---

# Tech-Spec: Deploy Page — Post-Deploy Configuration Flow

## Overview

### Problem Statement

The deploy page currently mixes configuration and deployment into a single flow.
Step 3 (configure) blocks deployment and only supports the calendar briefing
script. The other two scripts (Gmail to Drive, Calendar to Sheets) have no
configuration UI at all — users must manually edit `config.gs` in the Apps
Script editor.

### Solution

Restructure the deploy page into a clear 3-step flow:

1. **Sign In** — authenticate with Google
2. **Deploy** — select scripts, deploy immediately (no config required upfront)
3. **Configure** — after deploy succeeds, configure each deployed script via
   inline forms, then activate the trigger

## Functional Requirements by Step

### Step 1: Sign In with Google

- Sign-in button authenticates via Google Identity Services
- OAuth scopes: `script.projects`, `calendar.readonly`, `email`
- After sign-in: fetch user email (userinfo API), fetch calendar list
  (Calendar API) — these populate defaults in Step 3
- Sign-in status shown with checkmark

### Step 2: Choose Scripts & Deploy

- Checkbox list of all 3 scripts (unchanged)
- **Deploy button is inside this card** (not a separate section)
- Deploy button enabled when: signed in AND at least one script checked
- No configuration required before deploying
- On deploy: fetch source files from GitHub, create/reuse Apps Script project,
  upload `code.gs` + `config.gs` (template defaults) + `setup.gs` (hourly trigger)
- All scripts use hourly trigger in `setup.gs` — schedule logic is in `config.gs`
- `config.gs` is uploaded with template defaults (not user-customized yet — that
  happens in Step 3)

### Step 3: Configure Your Scripts

- **Only appears after successful deploy** (hidden before)
- Shows one card per deployed script
- Each card has:
  - Script name + link to open in Apps Script editor
  - **[Configure]** button that expands inline config form
  - After config is saved: **[Run setup()]** button + instructions
- **Configure button** opens the form; form has a **[Save Configuration]**
  button that PUTs updated `config.gs` to the Apps Script API
- After saving, show confirmation + "Run setup()" CTA

#### Calendar to Briefing Doc config fields:

| Field                      | Type                                        | Required | Default              |
| -------------------------- | ------------------------------------------- | -------- | -------------------- |
| Calendars to include       | Multi-select checkboxes (from Calendar API) | No       | All checked          |
| Send briefing to           | Text (email)                                | Yes      | Signed-in user email |
| Email subject              | Text                                        | No       | "Weekly Briefing"    |
| Frequency                  | Select: Weekly / Every N days               | No       | Weekly               |
| Day (if weekly)            | Select: Sun–Sat                             | No       | Monday               |
| Interval (if every N days) | Select: 1,2,3,5,7,14                        | No       | 1                    |
| At approximately           | Select: 5–9 AM                              | No       | 7 AM                 |
| Look ahead days            | Select: 3,5,7,10,14,30                      | No       | 7                    |

Timezone displayed as help text below the time field.

#### Gmail to Drive By Labels config fields:

| Field           | Type | Required | Default |
| --------------- | ---- | -------- | ------- |
| Trigger label   | Text | Yes      | —       |
| Processed label | Text | Yes      | —       |
| Google Doc ID   | Text | Yes      | —       |
| Drive Folder ID | Text | Yes      | —       |

Help text: links to create a new Doc / find folder ID.
Support multiple label configs (add/remove rows).

#### Calendar to Sheets config fields:

| Field          | Type                               | Required | Default  |
| -------------- | ---------------------------------- | -------- | -------- |
| Calendar       | Select (from Calendar API) or text | Yes      | Primary  |
| Spreadsheet ID | Text                               | Yes      | —        |
| Sheet name     | Text                               | No       | "Sheet1" |

Support multiple sync configs (add/remove rows).

### Step 4: Activate Trigger (inline in Step 3)

- After configuration is saved, show "Run setup()" CTA within the script's card
- Instructions: open script in Apps Script, click Run, select setup
- "Done — I ran setup()" button marks it complete
- This replaces the current standalone trigger CTA

## Technical Approach

### Config save mechanism

After the user fills in the config form and clicks "Save Configuration":

1. Build a customized `config.gs` string from the form values
2. Fetch current project content via `GET /projects/{id}/content`
3. Replace the `config` file's source with the new content
4. `PUT /projects/{id}/content` with the updated files array

This reuses the existing `apiFetch` helper and requires no new OAuth scopes.

### State management

- `deployedProjects` array (already exists) holds `scriptId` + `catalogId` for
  each deployed script
- Step 3 reads from this array to render config cards
- localStorage tracks which projects have been configured (similar to
  `SETUP_STORAGE_KEY`)

### Key constraint

The `config.gs` uploaded during Step 2 contains template defaults. This is
intentional — the script will work (with defaults) even if the user never
completes Step 3. Step 3 is an enhancement, not a gate.

## Out of Scope

- Editing config after initial setup (users can edit config.gs in the editor)
- Real-time validation of Doc IDs, Folder IDs, or Spreadsheet IDs
- Multi-user / team deployment flows
