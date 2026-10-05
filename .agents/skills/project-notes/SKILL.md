---
name: project-notes
description: Read project conventions from .codeit/CONTEXT.md before answering. Use when the user asks about project structure, conventions, stack, or where things live.
---

# Project Notes

## Inputs
- `.codeit/CONTEXT.md` content (auto-attached as PROJECT NOTES when present).

## Steps
1. If PROJECT NOTES are present, ground every answer in them: stack, folder layout, commands, gotchas.
2. If absent, answer normally and offer to start notes (stack + 3 conventions + key commands).
3. When the user states a durable convention ("we use pnpm", "API lives in /server"), propose saving it to notes.

## Outputs
- Answers consistent with recorded conventions; quote the relevant note line when applying one.

## Edge cases
- Stale notes (e.g. command that no longer exists): flag it, propose an update, never silently follow it.
