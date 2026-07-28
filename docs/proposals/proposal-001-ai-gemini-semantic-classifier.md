# Feature Proposal 001: Native Gemini AI Semantic Email Classifier & Auto-Filter Engine

## Executive Summary
This proposal introduces a native **Gemini AI Semantic Email Classifier** module into the `google-app-scripts` suite. 

By calling the Gemini REST API (`gemini-1.5-flash` / `gemini-2.0-flash`) natively via Google Apps Script's `UrlFetchApp.fetch()`, incoming unclassified emails are semantically categorized into target domain labels, and high-confidence classifications automatically generate permanent Gmail filter rules via the Advanced Gmail Service.

---

## Key Capabilities

1. **Zero-Configuration Semantic Classification**:
   - Classifies incoming emails from unknown senders based on semantic intent, sender, subject, and body snippet into target canonical labels (`Family/School`, `Finance/Taxes`, `Household/Rentals`, etc.).
2. **Self-Learning Gmail Filter Generation**:
   - When Gemini classifies a new sender with high confidence ($\ge 95\%$), the script automatically calls `Gmail.Users.Settings.Filters.create` to create a permanent static Gmail filter rule. Future emails from that sender are processed instantly by Gmail's fast native filter engine at $0$ cost.
3. **100% Cloud-Native & Serverless**:
   - Executes natively inside Google Apps Script via `UrlFetchApp.fetch()`. Requires zero external servers, Docker containers, or Python infrastructure.
4. **Human-in-the-Loop Active Learning**:
   - Detects manual label corrections made by the user in the Gmail Web/Mobile UI and updates future prompt context and filter rules.

---

## Architecture & Integration Flow

```
[Incoming Unclassified Email]
              │
              ▼
┌──────────────────────────────────────────┐
│ GOOGLE APPS SCRIPT TIME-DRIVEN TRIGGER   │
│ • Searches: 'inbox -label:AI-Processed'  │
└─────────────────────┬────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────┐
│ GEMINI REST API via UrlFetchApp.fetch()  │
│ • Model: gemini-1.5-flash                │
│ • Output: JSON Schema Classification     │
└─────────────────────┬────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌───────────────────────┐  ┌─────────────────────────────────┐
│ 1. Immediate Action   │  │ 2. Self-Learning Filter Rule    │
│ • Apply Gmail Label   │  │ • If Confidence >= 95%, calls   │
│ • Save Attachments    │  │   Gmail API to create permanent │
│ • Append Text Log     │  │   filter rule for new sender    │
└───────────────────────┘  └─────────────────────────────────┘
```

---

## Code Module Design

Target file structure in `google-app-scripts`:

```
src/gmail-ai-classifier/
├── README.md
├── code.gs
├── config.gs
└── tests/
    ├── code.test.js
    └── integration.test.js
```

---

## Discussion & Feedback
- Issue Tracked: [#491](https://github.com/petry-projects/google-app-scripts/issues/491)
- Repository: `petry-projects/google-app-scripts`
