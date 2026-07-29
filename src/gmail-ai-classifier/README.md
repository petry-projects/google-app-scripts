# Gmail AI Classifier & Auto-Filter Engine

A native Google Apps Script module that uses the Gemini REST API (`gemini-1.5-flash` / `gemini-2.0-flash`) to semantically classify incoming Gmail messages into standard canonical domain labels, save full-fidelity Email Thread PDFs to Google Drive, and commit Markdown summaries directly to `self-private` on GitHub via REST API.

---

## Multi-Account Household Deployment Guide (Option A)

To run this classifier across multiple household Gmail accounts (`donpetry@gmail.com` and `rachel.l.petry@gmail.com`):

### 1. Share Google Drive Taxonomy Folders

Share the 7 Canonical Domain folders in Google Drive (`01_Household` through `07_Community_NonProfit`) with full Editor access to `rachel.l.petry@gmail.com`.

### 2. Deploy Apps Script Worker Project

1. Log into Google Apps Script under `rachel.l.petry@gmail.com`.
2. Push or import this script repository (`google-app-scripts`).
3. Set **Script Properties** under Project Settings:
   - `GEMINI_API_KEY`: Your Gemini API key.
   - `GITHUB_PAT`: Personal Access Token with repo access to `don-petry/self-private`.
4. Set Time-Driven Trigger: Run `processEmailsWithAiClassifier` every 15 minutes.

---

## Features

- **Multi-Account Attribution**: Automatically tags entries with `- **Account**: rachel.l.petry@gmail.com` or `donpetry@gmail.com`.
- **Semantic Email Classification**: Evaluates incoming senders and body snippets into canonical domains.
- **Single Global `Processed` Marker**: Applies a single global `Processed` label to indicate Drive ingestion completion.
- **Inbox Preservation**: Processing emails into Google Drive preserves message visibility in the INBOX for human review.
- **100% Cloud-Native**: Runs natively inside Google Apps Script using `UrlFetchApp.fetch()`.
