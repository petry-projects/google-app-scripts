# Tag-Based Gmail Retention & Taxonomy Automation

A lightweight, 2-Stage Google Apps Script engine that classifies incoming emails into a structured taxonomy and applies explicit `Retention/...` tags (`Retention/30-Days`, `Retention/90-Days`, `Retention/1-Year`, `Retention/Permanent`, etc.) for 100% observability and manual control in Gmail.

## Features

- **Decoupled 2-Stage Architecture**: Separates label taxonomy classification from retention purge execution.
- **100% Observability**: View exact threads scheduled for deletion by clicking `Retention/30-Days` or `Retention/90-Days` in the Gmail UI.
- **Manual Control & Overrides**: Change an email's label in Gmail to `Retention/Permanent` to save it forever, or add `Retention/30-Days` to expedite cleanup.
- **Inbox Auto-Archiving**: Archives older labeled emails out of the main Inbox view (`Retention/Archive-60-Days`) without deleting them.
- **Self-Installing Trigger**: Runs automatically every hour via background time-driven trigger.

## Setup

1. Copy `code.gs`, `config.gs`, and `appsscript.json` to your Google Apps Script project.
2. Edit `config.gs` to define your custom taxonomy search queries and retention rules.
3. Run `createHourlyTrigger()` once to install the hourly background automation.
