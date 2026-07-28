# Gmail AI Classifier & Auto-Filter Engine

A native Google Apps Script that uses the Gemini REST API (`gemini-1.5-flash`) to semantically classify incoming Gmail messages into standard canonical domain labels and automatically generate permanent Gmail filter rules for new senders.

## Features

- **Semantic Email Classification**: Evaluates incoming email senders, subjects, and text snippets to route messages into canonical domains.
- **Single Global `Processed` Marker**: Applies a single global `Processed` label to indicate Drive ingestion completion without cluttering the sidebar.
- **Inbox Preservation**: Processing emails into Google Drive preserves message visibility in the INBOX for human review.
- **Self-Learning Filter Creation**: Automatically generates permanent static Gmail filter rules via the Advanced Gmail API when confidence >= 95%.
- **100% Cloud-Native**: Runs natively inside Google Apps Script using `UrlFetchApp.fetch()`.

## Configuration (`config.gs`)

Set your Gemini API key in Google Apps Script **Project Settings -> Script Properties** with key `GEMINI_API_KEY`.
