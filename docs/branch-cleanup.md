# Branch Cleanup

The following remote branches should be deleted as they are either merged into main or stale/abandoned.

## Merged into main (safe to delete)

```
git push origin --delete copilot/fix-gmail-to-drive-order
git push origin --delete copilot/sub-pr-7
git push origin --delete copilot/sub-pr-7-again
git push origin --delete copilot/sub-pr-7-one-more-time
git push origin --delete copilot/sub-pr-7-please-work
git push origin --delete copilot/sub-pr-7-yet-again
git push origin --delete feat/calendar-to-sheets
```

## Stale/abandoned (not merged, 6–7 weeks old with no activity)

```
git push origin --delete copilot/add-rebuild-doc-option
git push origin --delete copilot/fix-duplicate-line-breaks
git push origin --delete copilot/sub-pr-7-another-one
```

## Active branches (keep)

- `copilot/add-typescript-eslint-prettier` — 13 days ago
- `copilot/add-web-based-configuration-editor` — active (10 hours ago)
- `copilot/calendar-to-briefing-doc` — active (21 hours ago)
- `copilot/ensure-reverse-chronological-order` — 13 days ago
- `copilot/set-up-copilot-instructions` — 13 days ago
- `dependabot/npm_and_yarn/npm_and_yarn-e5a595f223` — active (10 hours ago)
