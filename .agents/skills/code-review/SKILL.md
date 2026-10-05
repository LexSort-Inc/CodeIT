---
name: code-review
description: Lint-level code review checklist. Use when the user asks for a review, a look-over, or PR feedback. Deep architecture review prefers cloud models.
---

# Code Review (lite)

## Inputs
- The diff or file under review (via +File to chat or pinned files).

## Steps
1. Check: correctness (off-by-one, null paths), error handling, secrets leaked, perf hotspots.
2. Check: matches repo conventions per AGENTS.md / PROJECT NOTES.
3. Report findings as: 🔴 must-fix, 🟡 suggestion, 🟢 nit — with file:line.
4. End with a verdict: approve, approve-with-nits, or needs-changes.

## Outputs
- Severity-sorted findings, each with a concrete fix. No vague praise.

## Edge cases
- Large diffs: review the riskiest files first (auth, payments, migrations), say what was skipped.
- Cannot verify runtime behavior: say so explicitly.
