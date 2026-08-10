---
name: use-v4-flash-worker
description: Dispatch the DeepSeek-backed v4_flash_worker through the installed one-shot plaintext SubagentStart Hook. Use immediately before spawning, continuing, or troubleshooting this worker; it governs plaintext staging, native fork_turns=none spawning and return, one-shot delivery-state recovery, and the configured provider/DeepSeek data boundary. Stable Sol/DeepSeek routing and task-mode roles belong in global AGENTS.md, not here.
---

# Use V4 Flash Worker

## Protect scope, data, and credentials

- The installed worker may run with broad filesystem access, while approval remains on request and is handled by Codex auto-review. Treat access as execution capability, not blanket task authority: every assignment must name the allowed paths and mutations, and the worker must stop instead of expanding that scope.
- Do not send secrets, private source, personal data, or regulated material unless the user has authorized the configured external provider and `deepseek-v4-flash` model data boundary.
- Keep the parent and its provider independent from the child transport. Do not switch the parent provider or model to delegate.
- Keep provider credentials in the provider environment. Never put credentials in the staged assignment, spawn message, or returned content.

## Deliver one self-contained job

1. Build one complete assignment that states the child identity, objective, necessary context, scope or constraints, and desired output clearly enough to stand alone. Add allowed paths, permitted mutations, exclusions, available permissions, evidence, or a stopping condition only when the task needs them. Keep it in parent-owned execution state; do not publish it as user-visible commentary merely for transport.
2. Pipe the assignment through stdin to the installed handoff script in `stage` mode. The platform state directory must already be covered by the parent session's writable roots; treat a missing persistent permission as installation drift instead of routinely discovering it through a failed stage. Use the standard installed path below. If the script is absent, inspect the effective `SubagentStart` Hook matching `^v4_flash_worker$` and use the same reviewed path with its mode changed from `hook` to `stage`:
   - Windows: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<codex-home>\hooks\codex-deepseek-subagent\plaintext-handoff.ps1" -Mode stage`
   - macOS/Linux: `python3 "<codex-home>/hooks/codex-deepseek-subagent/plaintext_handoff.py" --mode stage`
3. Require a successful stage result naming `v4_flash_worker`. Treat a lock contender, an active pending or claimed item, quarantined state, or any other non-success result as a transport failure. Never spawn after a failed stage. Retry the complete stage only after the occupied state is explicitly clear, and spawn only after that new stage succeeds.
4. Immediately create the child through Codex's native `spawn_agent` with the exact agent type `v4_flash_worker`, a unique task name, and `fork_turns="none"`. Do not replace this with a provider CLI, direct API call, or inherited root history. Keep all essential instructions in the staged assignment; let the spawn message only identify the trusted one-shot Hook.
5. Receive the child through Codex's native wait/callback path. Use one task-sized idle wait or callback; do not short-poll, duplicate the child work, or invent another return transport while it runs.
6. Verify the returned contribution in proportion to the parent claim, then integrate it in the parent context.

## Respect dispatch and delivery semantics

- Treat delivery as one-shot and at-most-once. Never assume a claimed assignment can be replayed or delivered to a replacement child.
- After a worker has received its assignment, it no longer holds the dispatch lock; you may stage and spawn the next job before that worker returns, and already-running workers continue concurrently.
- Require explicit resolution for malformed or quarantined state. Never delete, replace, or overwrite it automatically.

## Fail and continue safely

- Treat a missing Hook assignment, failed stage, unreadable child task, or absent callback as a transport failure. Do not silently substitute another provider, model, app, direct API call, CLI process, or inherited root history.
- Multi-agent V1 is an explicit top-level session compatibility choice, not a per-spawn switch or silent fallback.
- The staged assignment briefly exists as plaintext in local user state before dispatch to the configured external provider and `deepseek-v4-flash` model. The Hook is a transport compatibility layer, not a confidential channel.
