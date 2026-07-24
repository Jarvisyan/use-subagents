---
name: multi-subagents
description: Use multiple subagents in bounded GAN-style adversarial loops to strengthen Plan and Check for non-trivial tasks; skip trivial tasks with mechanical verification.
---

# Multi-Subagents

## Purpose

A strong model can execute a weak plan perfectly and then rationalize the result. Apply adversarial pressure before implementation and after it, while keeping execution focused.

## Organization

```text
Strongest available GPT Chair
|-- Plan: Chair drafts <-> DeepSeek Challenger attacks
|-- Execute: DeepSeek Worker(s) implement
`-- Check
    |-- Reproducible checks
    `-- GPT Chair attacks <-> DeepSeek Executor defends
```

The Chair retains the user goal, inspects the project, runs checks, adjudicates evidence, and reports. It must not silently replace DeepSeek as the code writer.

## Shared Adversarial Loop

1. **Claim:** The responsible side presents a plan or result with its assumptions and evidence.
2. **Attack:** The challenger targets concrete claims with counterexamples, missing evidence, failure modes, or a better alternative.
3. **Defend or revise:** The owner concedes and changes the claim, or answers with new evidence. Repetition is not a defense.
4. **Rebut:** Continue only when the challenger can add new evidence.

Stop when no new evidence appears and never exceed three rounds. The Chair decides by evidence, not votes. Escalate an unresolved high-impact dispute to the user with the decision, options, evidence, consequences, and recommendation.

## Plan

Inspect the project first. For clear, reversible, mechanically verifiable work, the Chair makes a concise plan alone.

Otherwise:

1. The Chair drafts the plan.
2. Call `ask_deepseek` as the Challenger.
3. Run the shared adversarial loop.
4. The Chair adopts the best-supported plan.

## Execute

Use `run_deepseek_worker`. Give it the adopted plan, scope and non-goals, project constraints, and acceptance checks. DeepSeek is the sole code writer.

Use `run_deepseek_workers` only for two or three independently implementable tasks in distinct worktrees. Keep one writer per workspace.

The Chair runs checks and returns concrete failures to DeepSeek for repair. If integration needs code changes, dispatch another bounded DeepSeek task. Retry DeepSeek once if unavailable; never silently fall back to GPT implementation.

## Check

Run reproducible checks first: tests, builds, type or lint checks, expected CLI output, experiment reruns, data invariants, links, rendering, or interaction checks.

The GPT Chair attacks the result against the original goal, adopted plan, actual diff or artifacts, and check evidence. The DeepSeek Executor defends or fixes it; the Chair rechecks through the shared adversarial loop.

Route implementation defects back to Execute, plan defects back to Plan, and unresolved authority or value decisions to the user.

For high-risk work, optionally add a fresh GPT Reviewer as an escalation, not as the default path.

## Guardrails

Use `high` effort by default and `max` only for difficult decisions. Use clean allowlisted Git worktrees, never send secrets, and keep the team as small as possible while still producing new evidence.
