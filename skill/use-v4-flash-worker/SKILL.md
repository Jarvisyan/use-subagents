---
name: use-v4-flash-worker
description: Use when Sol dispatches, continues, or troubleshoots a DeepSeek-backed v4_flash_worker job.
---

# Use V4 Flash Worker

## Purpose

This skill turns a Sol-defined local move into one staged, spawned, returned, and integrated DeepSeek-backed `v4_flash_worker` job. Sol holds the task thread: user goal, Plan, decomposition, current stage, acceptance criteria, review, and the decision to advance. DeepSeek handles local moves through native `v4_flash_worker`.

The dispatch frame is:

1. Sol understands the goal and chooses the next stage.
2. Sol assigns one or more DeepSeek jobs with self-contained instructions.
3. DeepSeek completes the assigned local move and returns evidence or changes.
4. Sol reviews the returned result, updates the task thread, and chooses the next stage.

This skill defines how one local move is prepared, staged, spawned, returned, and integrated.

## Assignment

DeepSeek receives the staged assignment as its working context, not the parent conversation. Write one self-contained local move: mode, objective, necessary context, scope, expected output, and return point. The mode names are assignment modes, not separate agents: use `ds_scout` for repository observation that returns evidence, and `ds_worker` for file changes, command execution, focused tests, or other accepted implementation stages.

Describe the target state and job boundary; give exact commands or step order when the task depends on them, otherwise let DeepSeek choose the concrete path inside the assignment. DeepSeek returns evidence, changes, blockers, or a next-step recommendation. Sol verifies the returned contribution, updates the task thread, and decides the next assignment.

## Dispatch And Return

Stage the assignment through stdin with the installed plaintext handoff script in `stage` mode, require a successful result naming `v4_flash_worker`, then spawn native `v4_flash_worker` with a unique task name and `fork_turns="none"`. Keep essential task instructions in the staged assignment; the spawn message only identifies the trusted Hook handoff. Use the native callback; when the result blocks Sol, call `wait_agent(timeout_ms=3600000)` once.

Standard stage commands:

- Windows: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<codex-home>\hooks\codex-deepseek-subagent\plaintext-handoff.ps1" -Mode stage`
- macOS/Linux: `python3 "<codex-home>/hooks/codex-deepseek-subagent/plaintext_handoff.py" --mode stage`

If the script is absent, inspect the effective `SubagentStart` Hook matching `^v4_flash_worker$` and use the same reviewed path with its mode changed from `hook` to `stage`.

Treat dispatch as one-shot delivery: stage succeeds before spawn, a claimed assignment is not replayed, and transport state is resolved before a fresh dispatch. Do not substitute another provider, model, CLI, inherited history, or Multi-agent V1 for this Hook path.

The staged assignment briefly exists as plaintext in local user state before dispatch to the configured external provider and `deepseek-v4-flash` model. Keep credentials in the provider environment; keep secrets, unrelated history, private source beyond the job scope, personal data, and regulated material out of the assignment unless the user has authorized that data boundary. Filesystem access is execution capability; the assignment boundary defines task authority.
