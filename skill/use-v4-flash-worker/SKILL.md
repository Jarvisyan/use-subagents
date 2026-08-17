---
name: use-v4-flash-worker
description: Use when Sol dispatches, continues, or troubleshoots a bounded subagent job, routed to native Luna by default with an explicit DeepSeek V4 Flash fallback.
---

# Use V4 Flash Worker

## Purpose

This skill turns a Sol-defined local move into one spawned, returned, and integrated subagent job. Sol holds the task thread: user goal, Plan, decomposition, current stage, acceptance criteria, review, and the decision to advance. Jobs route to native Luna (`luna_worker`) by default; the installed DeepSeek V4 Flash path is an explicit low-frequency external fallback.

The dispatch frame is:

1. Sol understands the goal and chooses the next stage.
2. Sol assigns one or more jobs with self-contained instructions.
3. The worker completes the assigned local move and returns evidence or changes.
4. Sol reviews the returned result, updates the task thread, and chooses the next stage.

This skill defines how one local move is prepared, staged, spawned, returned, and integrated.

## Assignment

The worker receives the assignment as its working context, not the parent conversation. Sol fills the unified assignment fields: `backend`, `mode`, `objective`, `necessary context`, `scope`, `expected output`, and `return point`. `backend` defaults to `luna`; supported modes are `scout` and `worker`. The mode names are assignment modes, not separate agents: use `scout` for repository observation that returns evidence, and `worker` for file changes, command execution, focused tests, or other accepted implementation stages. V1 uses a single custom agent named `luna_worker`.

Describe the target state and job boundary; give exact commands or step order when the task depends on them, otherwise let the worker choose the concrete path inside the assignment. The worker returns evidence, changes, blockers, or a next-step recommendation. Sol verifies the returned contribution, updates the task thread, and decides the next assignment.

## Dispatch And Return

**Luna (default).** Spawn native `luna_worker` with a unique task name and `fork_turns="none"`, placing the complete assignment directly in the spawn message. No stage or Hook. Use the native callback; when the result blocks Sol, call `wait_agent(timeout_ms=3600000)` once.

**DeepSeek fallback (explicit only).** Only when `backend` is explicitly `deepseek`: stage the assignment through stdin with the installed plaintext handoff script in `stage` mode, require a successful result naming `v4_flash_worker`, then spawn native `v4_flash_worker` with a unique task name and `fork_turns="none"`. Keep essential task instructions in the staged assignment; the spawn message only identifies the trusted Hook handoff. Use the native callback; when the result blocks Sol, call `wait_agent(timeout_ms=3600000)` once.

Standard stage commands:

- Windows: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<codex-home>\hooks\codex-deepseek-subagent\plaintext-handoff.ps1" -Mode stage`
- macOS/Linux: `python3 "<codex-home>/hooks/codex-deepseek-subagent/plaintext_handoff.py" --mode stage`

If the script is absent, inspect the effective `SubagentStart` Hook matching `^v4_flash_worker$` and use the same reviewed path with its mode changed from `hook` to `stage`.

Treat dispatch as one-shot delivery: stage succeeds before spawn, a claimed assignment is not replayed, and transport state is resolved before a fresh dispatch. Never silently fall back from Luna to an external provider; the DeepSeek path runs only when Sol explicitly selects it. Do not substitute another provider, model, CLI, inherited history, or Multi-agent V1 for the selected route.

The staged assignment briefly exists as plaintext in local user state before dispatch to the configured external provider and `deepseek-v4-flash` model. Keep credentials in the provider environment; keep secrets, unrelated history, private source beyond the job scope, personal data, and regulated material out of the assignment unless the user has authorized that data boundary. Filesystem access is execution capability; the assignment boundary defines task authority.
