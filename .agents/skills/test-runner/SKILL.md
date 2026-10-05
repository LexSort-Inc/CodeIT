---
name: test-runner
description: Detect and run the project test or build command, parse failures into fixes. Use when the user mentions tests, failing builds, CI, or verification.
---

# Test Runner

## Inputs
- Project root file listing (look for `package.json`, `pytest.ini`, `Makefile`, `*.sln`).

## Steps
1. Detect command:
   - `package.json` with `scripts.test` → `npm test`
   - Always available: `npm run build` (Vite) — catches syntax errors fast.
   - `pytest.ini`/`pyproject.toml` → `pytest -x -q`
2. Run via the approved command runner. Capture the first failing assertion only.
3. Report: failing file + line, expected vs actual, minimal fix. Do not dump whole logs.

## Outputs
- Pass/fail verdict, the single first failure, and a proposed patch.

## Edge cases
- No test setup: propose adding one before writing new logic.
- Long suites: run the single related file first (`pytest path/to/test.py`, `npx vitest path`).
