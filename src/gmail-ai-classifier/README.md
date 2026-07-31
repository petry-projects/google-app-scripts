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
   - `GITHUB_PAT`: Fine-grained GitHub Personal Access Token with write access to `self-private`.
   - `USER_ACCOUNT_EMAIL`: `user2@example.com`

### Step 3: Enable Automated Triggers

Run `setupFiveMinuteTrigger()` in Apps Script under Account #2.

---

## 🔑 Features

- **Multi-Account Attribution**: Automatically tags entries with `- **Account**: user2@example.com` or `user1@example.com`.
- **Dynamic User Discovery**: `Session.getEffectiveUser().getEmail()` automatically populates the account email dynamically at runtime.
- **7 Canonical Domain Folders**:
  - `01_Household`: Remodeling, Five Oaks lane property notes, utility bills.
  - `02_Finance_Legal`: Credit card statements, tax documents, mortgage notes, purchase receipts.
  - `03_Vehicles`: Vehicle registrations, parts orders, maintenance records.
  - `04_Family_Health`: Personal medical notes, ParentSquare school portals, student planning.
  - `05_Tech_Infrastructure`: Google Cloud spend alerts, security warnings, backup status.
  - `06_Work_Career`: Professional notes, work expenses, architecture docs.
  - `07_Community_NonProfit`: MyBroodMinder hive telemetry, non-profit BOD notes.
- **2-Year Category Retention Engine**: Automatically purges promotional, social, and forum emails older than 2 years every Sunday at 1:00 AM, while keeping core domain and personal threads **indefinitely**.
