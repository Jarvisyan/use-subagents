---
name: multi-subagents
description: Use multiple subagents in bounded GAN-style adversarial loops to strengthen Plan and Check for non-trivial tasks; skip trivial tasks with mechanical verification.
---

# Multi-Subagents

## Purpose

A strong model can execute a weak plan perfectly and then rationalize the result. Apply adversarial pressure before implementation and after it, while keeping execution focused.

## Organization

```text
GPT-5.6-sol Chair
|-- Plan: Chair drafts <-> GPT-5.6-sol Challenger attacks
|-- Execute: GPT-5.6-sol Worker(s) implement
`-- Check
    |-- Reproducible checks
    `-- GPT-5.6-sol Chair attacks <-> GPT-5.6-sol Executor defends
```

The Chair retains the user goal, inspects the project, runs checks, adjudicates evidence, and reports. It must not silently replace the designated GPT Worker as the code writer.

## Shared Adversarial Loop

1. **Claim:** The responsible side presents a plan or result with its assumptions and evidence.
2. **Attack:** The challenger targets concrete claims with counterexamples, missing evidence, failure modes, or a better alternative.
3. **Defend or revise:** The owner concedes and changes the claim, or answers with new evidence. Repetition is not a defense.
4. **Rebut:** Continue only when the challenger can add new evidence.

Stop when no new evidence appears and never exceed three rounds. The Chair decides by evidence, not votes. Escalate an unresolved high-impact dispute to the user with the decision, options, evidence, consequences, and recommendation.

## Plan

Inspect the project first. For clear, reversible, mechanically verifiable work, the Chair makes a concise plan alone.

When that concise-plan exception does not apply, read [the planning reference](references/plan.md) completely before drafting. Give the Challenger a grounded design view, a concise user-facing report, and the reference. Read [the worked planning example](references/plan-example.md) only when one problem may produce multiple peer scripts or output roots, or when the analysis objects remain unclear after reading the planning reference.

Otherwise:

1. The Chair drafts the plan with `xhigh` reasoning effort.
2. Spawn a GPT-5.6-sol subagent with `xhigh` reasoning effort as the Challenger.
3. Run the shared adversarial loop.
4. The Chair adopts the best-supported plan.

## Execute

Spawn a GPT-5.6-sol subagent with `high` reasoning effort as the Worker. Give it the adopted plan, scope and non-goals, project constraints, and acceptance checks. The designated GPT Worker is the sole code writer.

Spawn multiple GPT-5.6-sol Workers with `high` reasoning effort only for two or three independently implementable tasks in distinct worktrees. Keep one writer per workspace.

The Chair runs checks and returns concrete failures to the GPT Worker for repair. If integration needs code changes, dispatch another bounded GPT Worker task. Retry the subagent once if unavailable; the Chair must never silently take over implementation.

## Check

Run reproducible checks first: tests, builds, type or lint checks, expected CLI output, experiment reruns, data invariants, links, rendering, or interaction checks.

The GPT Chair uses `xhigh` reasoning effort to attack and adjudicate the result against the original goal, adopted plan, actual diff or artifacts, and check evidence. The GPT Executor uses `high` reasoning effort to defend or fix it; the Chair rechecks through the shared adversarial loop.

Route implementation defects back to Execute, plan defects back to Plan, and unresolved authority or value decisions to the user.

For high-risk work, optionally add a fresh GPT-5.6-sol Reviewer as an escalation, not as the default path. Use `max` reasoning effort only when that fresh Reviewer independently examines a high-impact evidence conflict.

## Guardrails

Use `high` reasoning effort for execution, `xhigh` for planning, attack, and adjudication, and `max` only for a fresh Reviewer independently examining a high-impact evidence conflict.

Use clean allowlisted Git worktrees, never send secrets, and keep the team as small as possible while still producing new evidence.
