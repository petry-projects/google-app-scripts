---
stepsCompleted:
  [
    'step-01-init',
    'step-02-discovery',
    'step-02b-vision',
    'step-02c-executive-summary',
    'step-03-success',
    'step-04-journeys',
    'step-05-domain',
    'step-06-innovation',
    'step-07-project-type',
    'step-08-scoping',
    'step-09-functional',
    'step-10-nonfunctional',
    'step-11-polish',
  ]
inputDocuments:
  - '_bmad-output/project-context.md'
  - 'github-issue-37 (web-based configuration editor)'
workflowType: 'prd'
briefCount: 1
researchCount: 0
projectDocsCount: 1
classification:
  projectType: web_app
  domain: general
  complexity: medium
  projectContext: brownfield
---

# Product Requirements Document - google-app-scripts

**Author:** Donpetry
**Date:** 2026-03-20

## Executive Summary

`google-app-scripts` is a self-serve browser-based tool that lets **anyone with a Google account** deploy and fully configure Google Apps Script automations — calendar syncs, email-to-doc pipelines, weekly briefings — without ever opening a code editor. The product removes every technical barrier between a user and a running automation: OAuth sign-in, script deployment, and configuration all happen inside a single HTML page.

Step 4 (Configure) closes the last mile. Until now, users who successfully deployed a script still had to hand-edit `config.gs` in the Apps Script editor — a task that requires knowing what a Google Calendar ID is, where to find it, and how to paste it into a JavaScript array. Step 4 replaces that with live dropdowns and pickers backed by the Gmail, Calendar, and Drive APIs. When the user clicks **Save**, their `config.gs` is written via the Apps Script API and they receive a clear, satisfying confirmation that their automation is live.

### What Makes This Special

Most automation tools target developers or require paid subscriptions. This tool targets the opposite end: someone who has never opened a terminal but wants their calendar events synced to a spreadsheet automatically. The differentiator is the **complete zero-to-running journey in one page** — sign in, choose, deploy, configure, done. The emotional finish line is a save confirmation that doesn't say "config updated" — it says _your automation is running_.

The core insight: adoption dies at configuration. Deployment is table stakes; the experience lives or dies in the moment after. Step 4 is what turns a deployed script into an automation someone actually uses.

### Project Classification

| Attribute           | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Project Type**    | Web app (vanilla HTML/JS, no framework)                                                      |
| **Domain**          | General — Google Workspace productivity automation                                           |
| **Complexity**      | Medium (OAuth + 4 Google APIs: Gmail, Calendar, Drive Picker, Apps Script)                   |
| **Project Context** | Brownfield — extending existing `deploy/index.html` (Steps 1–3 complete, PR #49 in progress) |

## Success Criteria

### User Success

- A non-technical user (no terminal, no code editor experience) can complete the full flow — sign in → choose script → deploy → configure → save — without external help or documentation
- The configuration form is self-navigating: all resource fields (labels, calendars, docs, folders) are presented as named, searchable dropdowns or pickers — no raw IDs entered manually
- After saving, the user receives a rich confirmation that verifies: (1) `config.gs` was written successfully, (2) the Apps Script trigger is active, and (3) the script project is accessible — not just an API success toast
- Returning users can open the configurator, see their existing config pre-populated, make changes, and save — without re-deploying

### Business Success

- The complete zero-to-running-automation journey is achievable by anyone with a Google account in a single browser session
- Both supported scripts (`gmail-to-drive-by-labels`, `calendar-to-sheets`) are fully configurable through the UI — no fallback to `config.gs` editing required for any supported field
- The deploy page handles all known error states gracefully: project not found, 0 config entries, API failures — non-technical users never see a raw API error

### Technical Success

- Config read (`projects.getContent`) and write (`projects.updateContent`) round-trip correctly for both scripts without data loss
- Save is idempotent — re-saving overwrites without duplicating or corrupting entries
- All new UI behaviour is covered by Playwright E2E tests; all extracted logic by Jest unit tests; coverage thresholds maintained

### Measurable Outcomes

- A user with no technical background can complete new-config setup for either script in under 5 minutes
- Zero raw API errors surface to the user under normal operating conditions
- Edit mode pre-populates existing config correctly 100% of the time when the project exists

## Product Scope

### MVP — Minimum Viable Product

- **New config flow**: Step 4 panel appears after deploy; user configures and saves for the first time
  - `gmail-to-drive-by-labels`: trigger label, processed label, Drive Doc (picker), Drive Folder (picker), batch size
  - `calendar-to-sheets`: calendar (dropdown), spreadsheet (picker), sheet name (text, auto-populated)
- **Edit config flow**: returning users see Step 4 with existing config pre-populated; can edit and re-save
- **Error handling**: "project not found" (404) shows a user-friendly message with recovery path; save blocked when 0 config entries
- **Save confirmation**: verifies config written + trigger active + script accessible; celebratory success state

### Growth Features (Post-MVP)

- Additional script automations added to the catalog (e.g. `calendar-to-briefing-doc`)
- Each new script added with its own config panel following the same pattern

### Vision (Future)

- A continuously growing catalog of Google Workspace automations, each fully configurable through the same zero-friction UI — making personal automation accessible to any Google account holder

## User Journeys

### Journey 1: Morgan Sets Up an Automation for the First Time

Morgan is a busy operations manager who heard that calendar events can auto-sync to a spreadsheet. She's not a developer — she's never opened the Apps Script editor — but she manages a shared Google Calendar and desperately wants a weekly snapshot in Sheets without copy-pasting. A colleague shared the deploy page URL.

**Opening scene:** Morgan opens the deploy page on a Tuesday afternoon. She signs in with Google, recognises the familiar OAuth screen, and grants access. Step 2 shows her a list of scripts with plain-language descriptions. She picks `calendar-to-sheets`.

**Rising action:** Step 3 deploys the script — a progress indicator runs, then a ✅. Step 4 appears: "Configure your automation." A dropdown labelled "Which calendar?" lists her calendars by name — she selects "Operations Calendar" instantly. A picker opens for "Destination spreadsheet" — she can navigate her full Drive folder structure, opening "Team Drives → Operations → Trackers" to find the right file. No need to remember the exact filename or search. The sheet name field auto-fills "Sheet1." She adds a second config row for her personal calendar in thirty seconds.

**Climax:** Morgan clicks **Save Configuration**. A verification sequence runs visibly: config written ✅ → trigger active ✅ → script accessible ✅. Then a celebratory confirmation: _"🎉 Your automation is live! Calendar events will sync to Ops Tracker automatically."_

**Resolution:** Morgan closes the tab. No `config.gs`, no Apps Script editor, no IDs copied from URL bars. The next morning her spreadsheet has yesterday's events. She shares the deploy page URL with a teammate.

_Capabilities revealed: named calendar dropdown, Drive Picker with full folder navigation, multi-row config, animated save verification, celebratory confirmation._

---

### Journey 2: Morgan Updates Her Configuration Six Weeks Later

Morgan's team moved to a new spreadsheet. She needs to point the automation at the new doc. She remembers the deploy page but isn't sure if she has to start over.

**Opening scene:** Morgan reopens the deploy page and signs in. She lands on a returning-user state — Step 4 shows her existing configuration pre-populated: "Operations Calendar → Ops Tracker / Sheet1." She immediately understands she can edit it.

**Rising action:** She clicks the spreadsheet picker next to the Operations Calendar row. It opens on Drive and she navigates her folder structure to select the new sheet. She doesn't touch the other row.

**Climax:** She clicks **Save Configuration**. The same verification sequence runs. _"🎉 Your automation is updated and running."_

**Resolution:** Two minutes, no re-deploy. Morgan gains confidence: this tool is hers to manage, not a one-time setup wizard.

_Capabilities revealed: config pre-population on return visit, edit-in-place without re-deploying, idempotent save._

---

### Journey 3: Morgan Encounters an Error and Recovers

Morgan's colleague Alex tries the deploy page on his own account. He deployed months ago via a different flow and his script project ID is stale — it no longer exists in the Apps Script API.

**Opening scene:** Alex signs in, skips Step 2 (no new deploy needed, he thinks), and Step 4 tries to load his existing config. The API returns a 404.

**Rising action:** Instead of a raw `{"error": "Requested entity was not found"}`, Alex sees: _"We couldn't find your script project — it may have been deleted or moved. Re-deploy in Step 3 to create a fresh project, then configure it here."_ A "Go to Step 3" button appears.

**Climax:** Alex re-deploys. Step 4 opens with an empty config form (no stale data). He configures from scratch in under five minutes.

**Resolution:** Alex never saw a developer error. The recovery path was one click.

_Capabilities revealed: user-friendly 404 state with recovery CTA, save blocked on 0 entries._

---

### Journey Requirements Summary

| Capability                                                        | Revealed by            |
| ----------------------------------------------------------------- | ---------------------- |
| Named calendar/label dropdowns (no IDs)                           | Journey 1              |
| Drive Picker with full folder navigation (not just recent/search) | Journey 1 + user input |
| Multi-row config (add / remove entries)                           | Journey 1              |
| Animated save verification (config + trigger + access)            | Journey 1              |
| Celebratory success confirmation                                  | Journey 1              |
| Config pre-population on return visit                             | Journey 2              |
| Edit-in-place without re-deploying                                | Journey 2              |
| Idempotent save (overwrite, not append)                           | Journey 2              |
| User-friendly 404 with recovery CTA                               | Journey 3              |
| Save blocked when 0 config entries                                | Journey 3              |

## Domain-Specific Requirements

### Platform Constraints (Google APIs)

- **OAuth scopes**: the token must include `script.projects`, `script.deployments`, `script.triggers` (for trigger verification), `drive` (for Picker), `gmail.labels`, `calendar.readonly` — all must be present at sign-in; missing scopes cause silent failures or mid-flow permission prompts
- **Trigger verification**: call the Apps Script API post-save to confirm at least one trigger is registered for the entry-point function; if the call fails or returns inconclusive results, degrade gracefully — show config-written ✅ and script-accessible ✅ but mark trigger check as inconclusive rather than falsely confirmed
- **Drive Picker — folder navigation**: the current Picker implementation does not show folders; fix by configuring `DocsView` with `setIncludeFolders(true)` so users can navigate their full folder hierarchy — this is a required behaviour, not polish
- **Picker Developer Key**: already registered and functional; no new Cloud project setup required
- **Apps Script API quota**: `projects.getContent` / `projects.updateContent` are quota-limited; no throttling logic needed for MVP, but API errors must surface as user-friendly messages (not raw JSON)
- **OAuth redirect / Picker origin**: deploy page origin must be registered as an authorised JavaScript origin; already functional — no change needed

### Risk Mitigations

| Risk                                                     | Mitigation                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Trigger verification API unavailable or inconclusive     | Degrade gracefully — show partial confirmation, never show false "trigger active ✅" |
| Picker loads but user can't find file without folder nav | Fix `DocsView` folder navigation in MVP — known current gap                          |
| User saves 0 config entries → confusing 404 from API     | Block Save button until ≥1 valid entry exists                                        |
| Stale project ID (404 on load)                           | Show user-friendly recovery message with "Go to Step 3" CTA                          |
| OAuth token missing required scope                       | Detect at sign-in and request all scopes upfront; do not request incrementally       |

## Web App Specific Requirements

### Project-Type Overview

Single-page application (SPA) delivered as a single `deploy/index.html` file — no build step, no server-side rendering, no SEO indexing (app is behind OAuth). Runs entirely in the browser, authenticating via Google OAuth and calling Google APIs directly. Served statically (e.g., GitHub Pages or local file open).

### Browser Matrix

| Browser          | Support Level        |
| ---------------- | -------------------- |
| Chrome (latest)  | Primary — required   |
| Firefox (latest) | Supported            |
| Safari (latest)  | Supported            |
| Edge (latest)    | Supported            |
| Mobile browsers  | Not targeted for MVP |

Modern baseline: ES2020+, CSS Grid/Flexbox, Fetch API — no polyfills required.

### Responsive Design

- Desktop-first; primary use case is a laptop/desktop during initial setup
- Minimum supported viewport: 1024px wide
- Mobile/tablet: not targeted for MVP; graceful degradation acceptable

_Performance targets and accessibility standards are defined in the Non-Functional Requirements section._

### Implementation Considerations

- All logic in a single `deploy/index.html` — no bundler, no build toolchain
- Google libraries loaded from CDN: `apis.google.com/js/api.js` (gapi), `accounts.google.com/gsi/client` (GIS)
- State: in-memory for session; localStorage for project IDs only (idempotent deploy)
- Playwright E2E tests run in Chromium and cover the full user flow

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Experience MVP — the product succeeds when a non-technical user completes their first automation setup with zero hand-holding, feels the "aha" moment, and the automation is genuinely running.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**

- First-time setup → new config for `gmail-to-drive-by-labels`
- First-time setup → new config for `calendar-to-sheets`
- Return visit → edit existing config for either script
- Error recovery → stale/missing project with guided recovery

**Must-Have Capabilities:**

1. OAuth sign-in (all required scopes upfront)
2. Script deploy: create or reuse existing Apps Script project (idempotent)
3. Config editor — **New**: `gmail-to-drive-by-labels` (labels → Drive folder, with Picker folder navigation)
4. Config editor — **New**: `calendar-to-sheets` (calendar → Sheet selector)
5. Config editor — **Edit**: load and modify existing config for either script
6. Save + verify: config written ✅ · trigger active ✅ (best-effort, graceful degrade) · script accessible ✅
7. Celebratory save confirmation UX
8. Save blocked when 0 config entries
9. User-friendly error with "Go to Step 3" recovery CTA
10. Drive Picker with full folder navigation (`setIncludeFolders(true)`)

### Post-MVP Features

**Phase 2 — Growth:**

- Additional script automations added to the catalog (e.g., Sheets → email digest)
- Multi-entry config management (bulk add/remove rows)
- Config export/import (JSON download)

**Phase 3 — Expansion:**

- Community-contributed automation scripts
- Config sharing between users
- Monitoring / last-run status dashboard

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Catalog-native extensibility**
The deploy page is architected as a script _host_, not a script-specific UI. Each entry in `SCRIPT_CATALOG` brings its own config schema; the Step 4 panel renders the appropriate form. `calendar-to-briefing-doc` (shipping in PR #58) is the first proof point: a calendar → Google Doc pipeline fully deployable and configurable from the browser, with zero code editing. Every future script added to the catalog inherits the same zero-friction journey for free.

**2. Configuration UX as competitive moat**
The README's current Setup instructions still require the user to manually enter `calendarId` and `docId` raw strings. Step 4 eliminates this by replacing raw IDs with named dropdowns (calendars) and Drive Picker (docs) — the same pattern proven for `calendar-to-sheets`. The moat: no comparable open-source GAS tool offers full browser-based config with live API-backed pickers.

**3. AI-pipeline source documents**
The README explicitly positions the briefing doc as "a source document for tools like NotebookLM." This is an emerging use case — structured calendar narrative as RAG input — that no existing calendar tool names. Worth surfacing in scope to frame the audience beyond productivity.

### Market Context & Competitive Landscape

| Existing solution            | Gap                                                       |
| ---------------------------- | --------------------------------------------------------- |
| Zapier / Make                | Paid, no GAS ecosystem, no Drive Picker                   |
| Apps Script editor (manual)  | Requires coding; no UI config                             |
| Google Workspace Marketplace | Apps require publication & review; no personal automation |
| This tool                    | Free, browser-only, growing catalog, zero coding required |

### Validation Approach

- `calendar-to-briefing-doc` is already built and tested (249 tests, 99% coverage) — the catalog pattern is validated by existence, not hypothesis
- Step 4 config for `calendar-to-briefing-doc` follows the same schema pattern as `calendar-to-sheets` — validation is: does the Drive Doc picker correctly populate `docId` in `config.gs`?
- NotebookLM use case: out of scope for MVP validation; noted as future signal

### Risk Mitigation

| Risk                                                        | Mitigation                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Catalog grows faster than config UI can support new schemas | Define a schema contract for `SCRIPT_CATALOG` entries; Step 4 renders any conforming schema |
| Drive Picker fails to return Doc ID correctly               | Tested in `calendar-to-sheets` flow; reuse same picker component                            |
| NotebookLM positioning dilutes focus                        | Keep it as a footnote / future positioning note; MVP success criteria unchanged             |

## Functional Requirements

### Authentication & Authorization

- **FR1:** User can sign in with their Google account
- **FR2:** User can grant all required Google API permissions in a single sign-in flow (no mid-flow permission prompts)
- **FR3:** User can sign out

### Script Deployment

- **FR4:** User can create a new Apps Script project for a selected automation
- **FR5:** User can reuse an existing Apps Script project without overwriting it (idempotent deploy)
- **FR6:** System can detect whether a project has already been deployed for the current user
- **FR7:** User can view the current deployment status of their project

### Gmail-to-Drive Configuration

- **FR8:** User can view all existing label-to-folder mapping rules
- **FR9:** User can add a new label-to-folder mapping rule
- **FR10:** User can select a Gmail label from their account's label list
- **FR11:** User can select a destination Drive folder for a label mapping
- **FR12:** User can edit an existing label-to-folder mapping rule
- **FR13:** User can remove an existing label-to-folder mapping rule
- **FR14:** System prevents saving when no mapping rules exist

### Calendar-to-Sheets Configuration

- **FR15:** User can view all existing calendar-to-sheet mapping rules
- **FR16:** User can add a new calendar-to-sheet mapping rule
- **FR17:** User can select a Google Calendar from their calendar list
- **FR18:** User can select a destination Google Sheet for a calendar mapping
- **FR19:** User can edit an existing calendar-to-sheet mapping rule
- **FR20:** User can remove an existing calendar-to-sheet mapping rule
- **FR21:** System prevents saving when no mapping rules exist

### File & Folder Selection

- **FR22:** User can browse their Google Drive folder hierarchy to select a destination folder
- **FR23:** User can navigate into and out of folders during Drive selection
- **FR24:** User can select a Google Sheet from their Drive via a file picker

### Save & Verification

- **FR25:** User can save their configuration to the deployed Apps Script project
- **FR26:** System verifies the configuration was successfully written after save
- **FR27:** System verifies the automation trigger is active after save (best-effort — degrades gracefully)
- **FR28:** System verifies the Apps Script project is accessible after save
- **FR29:** User receives a celebratory confirmation when all checks pass
- **FR30:** User sees a partial confirmation when trigger verification is inconclusive — system never shows a false positive

### Configuration Loading (Edit Mode)

- **FR31:** User can load their existing configuration from a previously deployed project
- **FR32:** System identifies which automation script a project is configured for

### Error Recovery & Guidance

- **FR33:** User receives a human-readable error message when the Apps Script project cannot be found
- **FR34:** User can navigate directly to the deployment step from an error state
- **FR35:** User receives guidance when required API permissions are missing
- **FR36:** System surfaces all API errors as descriptive messages (never raw JSON)

## Non-Functional Requirements

### Performance

- Page load: initial HTML + Google CDN libraries load and render within **2 seconds** on a standard broadband connection
- OAuth sign-in round-trip completes within **3 seconds** perceived (including redirect)
- Config save + all verification checks complete within **5 seconds**; a visible progress indicator is shown for any operation exceeding 1 second
- Dropdown population (Gmail labels, calendars) loads within **3 seconds** of sign-in

### Security

- OAuth tokens are held in memory only — never written to localStorage, sessionStorage, or cookies
- All API calls go directly from the browser to Google APIs — no proxy server, no third-party telemetry
- Only the project IDs needed for idempotency are stored in localStorage; no user data is persisted client-side
- The app must be served over HTTPS (GitHub Pages or equivalent); HTTP is not supported
- A Content Security Policy header restricts script sources to `self`, `apis.google.com`, and `accounts.google.com`

### Accessibility

- Meets **WCAG 2.1 Level AA** across all interactive flows
- All functionality is reachable via keyboard alone (Tab / Enter / Space / arrow keys for dropdowns)
- All dynamic UI changes (save confirmation, error states, loading indicators) are announced to screen readers via ARIA live regions
- Focus is programmatically managed after async operations return
- Color is never the sole means of conveying information (errors, status checks)
- All text and interactive element color combinations meet AA contrast ratio (4.5:1 for normal text, 3:1 for large text)
