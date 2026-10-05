---
name: commit-helper
description: Write conventional commits, stage files, draft PR titles. Use when the user mentions commit, conventional commits, staging, or PR messages.
---

# Commit Helper

## Inputs
- `git status --porcelain` and `git diff --stat` (run via TerminalPane or exec).

## Steps
1. Group changed files by area (feat, fix, docs, chore, refactor).
2. Stage deliberately: `git add <paths>` — never `git add -A` without showing the list first.
3. Message format: `<type>(<scope>): <short imperative summary>`
   - Types: feat, fix, docs, style, refactor, test, chore.
   - Keep the subject under 72 chars. Body bullets for why, not what.
4. PR title uses the same format. Include test evidence (`npm run build` output).

## Outputs
- The exact `git commit -m` command for the user to approve and run.
- Never commit without explicit user approval.

## Edge cases
- If unrelated changes are mixed, propose splitting into two commits.
- If no git repo, say so instead of guessing.
