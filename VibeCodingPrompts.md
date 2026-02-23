# Landscaper Vibe Coding Prompts

Use these prompts to implement in controlled stages without re-explaining context every time.

## Stage Build Prompt
Use when starting a phase from `DesignDoc.md`.

```text
Implement Phase <N> from DesignDoc.md for Landscaper.
Requirements:
- Follow Implementation Guardrails and MVP Scope in DesignDoc.md.
- Keep changes scoped to this phase only.
- Include any required types/state/actions/tests for this phase.
- Do not add backend APIs; persistence must stay localhost-only.

When done, provide:
1) Files changed
2) What was implemented
3) Any known risks/gaps
```

## Phase Closeout Prompt
Use after a phase is implemented.

```text
Review the current implementation against the MVP Acceptance Checklist in DesignDoc.md.
Return:
1) Pass/fail per checklist item
2) Bugs or regressions found (with file references)
3) Minimum patch list to close any failures
```

## Bugfix Prompt
Use for targeted fixes.

```text
Fix this Landscaper issue: <describe issue>.
Constraints:
- Preserve existing behavior outside the bug.
- Add/update tests if a test layer exists.
- Keep persistence schema backward compatible with landscaper.plans.v1.
Return root cause, changed files, and verification steps.
```

## Refactor Prompt
Use when code starts feeling messy.

```text
Refactor the current Landscaper code for clarity and maintainability.
Constraints:
- No user-facing behavior changes.
- Keep store action signatures stable unless strictly necessary.
- Keep localStorage format and keys unchanged.
Deliver:
1) Refactor summary
2) Before/after structure
3) Any migration or risk notes
```

## UI Polish Prompt
Use for focused polish once core behavior works.

```text
Polish the Landscaper UI without changing core workflows.
Focus:
- Visual hierarchy of toolbar, canvas, and element panel
- Empty states and inline guidance
- Small motion feedback for stamp placement/save success
Constraints:
- Keep controls and keyboard shortcuts unchanged
- Preserve accessibility (focus visibility, labels, contrast)
```

## Fast Smoke Test Prompt
Use before ending a coding session.

```text
Run a fast manual smoke-test checklist for Landscaper and report results:
- Background upload
- Element create/edit
- Stamping/select/move
- Resize handles + center scaling
- Z-order controls
- Undo/redo buttons + keyboard shortcuts
- Zoom with Shift+Scroll
- Save/load/rename across refresh
Return only failures, suspected causes, and patch suggestions.
```
