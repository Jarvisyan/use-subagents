---
name: multi-subagents
description: Use multiple subagents in bounded GAN-style adversarial loops to strengthen Plan and Check for non-trivial tasks; skip trivial tasks with mechanical verification.
---

# Multi-Subagents

## Core Model

A strong model can execute a weak plan perfectly and then rationalize the result. Apply adversarial pressure before implementation and after it, while keeping execution focused.

### Roles and Effort

```text
GPT-5.6-sol Chair (`xhigh`: plan, attack, adjudicate)
|-- Plan: Chair drafts <-> GPT-5.6-sol Challenger (`xhigh`) attacks
|-- Execute: GPT-5.6-sol Worker(s) (`high`) implement
`-- Check
    |-- Reproducible checks
    `-- Chair attacks <-> GPT-5.6-sol Executor (`high`) defends or fixes
```

Keep the Chair responsible for the user goal, project inspection, checks, adjudication, and reporting, but never implementation writing. Assign one writer per workspace at a time: the Worker during Execute and the Executor during Check. Use a fresh GPT-5.6-sol Reviewer with `max` effort only to examine a high-impact evidence conflict independently.

### Shared Adversarial Loop

1. **Claim:** The responsible side presents a plan or result with its assumptions and evidence.
2. **Attack:** The challenger targets concrete claims with counterexamples, missing evidence, failure modes, or a better alternative.
3. **Defend or revise:** The owner concedes and changes the claim, or answers with new evidence. Repetition is not a defense.
4. **Rebut:** Continue only when the challenger can add new evidence.

Stop when no new evidence appears and never exceed three rounds. The Chair decides by evidence, not votes. Escalate an unresolved high-impact dispute to the user with the decision, options, evidence, consequences, and recommendation.

## Workflow

### Plan

Inspect the project first. For clear, reversible, mechanically verifiable work, the Chair makes a concise plan alone.

For a non-trivial Plan, read [the planning reference](references/plan.md) completely before drafting. Draft a grounded design view and a concise user-facing report, spawn the Challenger with both and the reference, run the shared adversarial loop, and adopt the best-supported plan.

### Execute

Spawn the Worker with the adopted plan, scope and non-goals, project constraints, and acceptance checks.

Spawn multiple Workers only for two or three independently implementable tasks in distinct worktrees. Keep one writer per workspace.

The Chair runs checks and returns concrete failures to the Worker for repair. Retry the subagent once if unavailable; the Chair must never silently take over implementation.

### Check

Run reproducible checks first: tests, builds, type or lint checks, expected CLI output, experiment reruns, data invariants, links, rendering, or interaction checks.

Attack and adjudicate the result against the original goal, adopted plan, actual diff or artifacts, and check evidence. Have the Executor defend it with evidence or make bounded fixes, then have the Chair rerun the checks and continue the shared adversarial loop.

Let the Executor repair bounded implementation defects during Check. Route plan defects back to Plan, defects requiring broad rework back to Execute, and unresolved authority or value decisions to the user. For high-risk work, add the fresh Reviewer only as an escalation, not as the default path.

## Guardrails

Use clean allowlisted Git worktrees, never send secrets, and keep the team as small as possible while still producing new evidence.
