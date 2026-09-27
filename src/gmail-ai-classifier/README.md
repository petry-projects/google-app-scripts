# Gemini AI-Powered Semantic Email Classifier & Auto-Filter Engine

A production-ready Google Apps Script (GAS V8) engine that automatically classifies Gmail inbox messages into 7 canonical household domain folders using Google AI Studio (Gemini 3.5 & Gemma 4 31B), creates permanent native Gmail filters for high-confidence senders, and syncs executive summaries to GitHub note repositories.

---

## 🌟 Multi-Account Household Setup Guide

To run this classifier across multiple household Gmail accounts (`user1@example.com` and `user2@example.com`):

### Step 1: Share Canonical Drive Note Folders

Share the 7 Canonical Domain folders in Google Drive (`01_Household` through `07_Community_NonProfit`) with full Editor access to `user2@example.com`.

### Step 2: Deploy Script Instance to Account #2

1. Log into Google Apps Script under `user2@example.com`.
2. Push or copy `code.gs`, `config.gs`, `gitHubSync.gs`, and `appsscript.json`.
3. Open **Project Settings (gear icon)** $\rightarrow$ **Script Properties**.
4. Add the following keys:
   - `GEMINI_API_KEY`: Your Google AI Studio API key.
   - `GITHUB_PAT`: Fine-grained GitHub Personal Access Token with write access to your target repository.
   - `USER_ACCOUNT_EMAIL`: `user2@example.com`
   - `CUSTOM_PROMPT_RULES`: _(Optional)_ User-specific domain and student attribution rules appended dynamically to the AI prompt without code modifications.

### Step 3: Enable Automated Triggers

Run `setupFiveMinuteTrigger()` in Apps Script under Account #2.

---

## 🔑 Features

- **Multi-Account Attribution**: Automatically tags entries with `- **Account**: user2@example.com` or `user1@example.com`.
- **Dynamic User Discovery**: `Session.getEffectiveUser().getEmail()` automatically populates the account email dynamically at runtime.
- **7 Canonical Domain Folders**:
  - `01_Household`: Remodeling, property maintenance, contractor bids, utility bills.
  - `02_Finance_Legal`: Credit card statements, tax documents, mortgage notes, purchase receipts.
  - `03_Vehicles`: Vehicle registrations, parts orders, maintenance records.
  - `04_Family_Health`: Personal medical notes, school portals, doctor visits, student planning.
  - `05_Tech_Infrastructure`: Google Cloud spend alerts, security warnings, backup status.
  - `06_Work_Career`: Professional notes, work expenses, architecture docs.
  - `07_Community_NonProfit`: Sensor telemetry, non-profit BOD notes, charity updates.
- **2-Year Category Retention Engine**: Automatically purges promotional, social, and forum emails older than 2 years every Sunday at 1:00 AM, while keeping core domain and personal threads **indefinitely**.

---

## 🛠️ Tuning & Customization Architectural Guidance

To keep this codebase a **clean, generic, reusable open-source harness** suitable for any household or organization:

### 1. Decouple Core Engine from Personal Specializations

- **Generic Engine**: `code.gs` and `gitHubSync.gs` handle the orchestration: batch fetching, AI prompt assembly, JSON extraction, Gmail category tab assignment (`setGmailCategoryTab`), label lifecycle (`ensureUserLabel`), and GitHub API note ingestion.
- **No Hardcoded Personal Entities in Core**: Engine source files should remain agnostic of specific student names, local schools, private businesses, or personal contacts.
- **Extensible Prompt Injection**: When personalizing the Gemini classification rules, inject customized domain rules via `config.gs` or `ScriptProperties` rather than baking private household specifics into the open-source repository.

### 2. Policy on One-Time Cleanups & Realignment Routines

- **Never Embed in the Recurring Trigger**: Maintenance routines designed to fix historical label anomalies (e.g., swapping a student label across past threads) must **never** be committed into the continuous 5-minute automation loop (`processEmailsWithAiClassifier`).
- **Standalone Execution Pattern**:
  1. Implement one-off cleanups as standalone migration scripts (e.g. in a private workspace `scripts/` directory or an isolated manual function in GAS).
  2. Execute and verify completion once.
  3. Remove the migration code immediately.

### 3. Classification Tuning Lifecycle

- **Observation**: Periodically audit classification results using automated scanner scripts or by inspecting ingestion commit logs.
- **Generic Rule Refinement**: When common patterns emerge (e.g., delivered vs. in-transit shipments, auto-paid vs. manual bills), update the generic open-source rules so all users benefit.
- **Entity Attribution Tuning**: When student, school, or organization attribution shifts, update the user configuration mapping.
- **Verification**: Run unit tests (`npm test -- src/gmail-ai-classifier`) to verify that prompt and classification changes maintain zero regressions.
