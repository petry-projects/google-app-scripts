# Feature Proposal 001: Native Gemini AI Semantic Email Classifier & 7-Domain Taxonomy Engine

## Executive Summary
This proposal introduces a native **Gemini AI Semantic Email Classifier & Standard Taxonomy Engine** into the `google-app-scripts` suite. 

By calling the Gemini REST API (`gemini-1.5-flash` / `gemini-2.0-flash`) natively via Google Apps Script's `UrlFetchApp.fetch()`, incoming unclassified emails are semantically categorized into **7 Standard Canonical Domains**, and high-confidence classifications automatically generate permanent Gmail filter rules via the Advanced Gmail Service.

---

## Idempotency & Reprocessing Workflows

- **Query Guard**: Ingestion routines process threads matching `label:Category -label:Processed`.
- **Deduplication Safety Nets**: MD5 native checksums (`file.getMd5Checksum()`) prevent duplicate attachment saves; thread markers (`[THREAD:id]`) prevent duplicate text logs.
- **Single-Click Reprocessing**: Removing the `Processed` label from an email thread in Gmail causes the script to re-evaluate, re-clean, and re-process the thread on its next run.

---

## Clean Ingestion Marker: Single Global `Processed` Label

- **Eliminating Duplicate Labels**: Rather than creating parallel `-Processed` labels (which doubles sidebar labels from 20 to 40+), the script applies a **single global `Processed` label** (or Green Star badge) to indicate Drive ingestion completion.
- **Category Preservation**: The thread retains its canonical category label (`Family/School-Toby`, `Finance/Taxes`).
- **Inbox Preservation**: Processing an email into Google Drive **MUST NOT remove the message from the user's INBOX**. The email thread remains visible in the Inbox for human review until explicitly archived or deleted by the user.

---

## Standard 7-Domain Taxonomy Matrix (PARA / ISO 15489 / MECE Aligned)

The classifier operates against a standardized, mutually exclusive, collectively exhaustive (MECE) 7-domain taxonomy:

| 7 Canonical Domains | Standard PARA Area | Scope & Contents |
| :--- | :--- | :--- |
| **`01_Household`** | Real Estate & Living Space | Primary residence (2809 Five Oaks), shop build, rental (3535 Broken Bow), 18 Running Deer archive |
| **`02_Finance_Legal`** | Financial & Legal Protections | Taxes, banking (Schwab/BoA), insurance policies, court records, custody, estate planning |
| **`03_Vehicles`** | Transportation & Assets | Vehicle searches (2026 car hunt), vehicle titles, Mercedes logs, auto maintenance |
| **`04_Family_Health`** | Family Welfare & Health | Children (Toby, Tide), school IEPs, speech/audiology reports, medical history, AYOP camps |
| **`05_Tech_Infrastructure`**| IT & Home Automation | Home Assistant, NAS backups, Tasker scripts, network gear, software licenses |
| **`06_Work_Career`** | Professional Life & Income | EY architecture, resumes, job interview decks, expense reports, admin notes |
| **`07_Community_NonProfit`**| Civic Duty & Service | HelpingOneGuy 501(c)(3) charity, JeffCo Bees BOD, faith outreach |

---

## Key Capabilities

1. **Zero-Configuration Semantic Classification**:
   - Classifies incoming emails from unknown senders based on semantic intent, sender, subject, and body snippet into target canonical labels (`Family/School`, `Finance/Taxes`, `Household/Rentals`, etc.).
2. **Self-Learning Gmail Filter Generation**:
   - When Gemini classifies a new sender with high confidence ($\ge 95\%$), the script automatically calls `Gmail.Users.Settings.Filters.create` to create a permanent static Gmail filter rule. Future emails from that sender are processed instantly by Gmail's fast native filter engine at $0$ cost.
3. **Single-Click Reprocessing**:
   - Simply remove the `Processed` label from any thread to re-run and re-ingest.
4. **100% Cloud-Native & Serverless**:
   - Executes natively inside Google Apps Script via `UrlFetchApp.fetch()`. Requires zero external servers, Docker containers, or Python infrastructure.

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

## Discussion & Tracking
- Issue Tracked: [#491](https://github.com/petry-projects/google-app-scripts/issues/491)
- Pull Request Tracked: [#492](https://github.com/petry-projects/google-app-scripts/pull/492)
- Repository: `petry-projects/google-app-scripts`
