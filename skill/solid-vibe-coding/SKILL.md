---
name: solid-vibe-coding
description: Use for research or exploratory coding iterations where AI should work with minimal stepwise supervision while adversarial Plan and implementation-fidelity reviews support user decisions before and after execution.
---

# Solid Vibe Coding

## Objective

Automate the research iteration without automating away judgment. Let the user leave stepwise supervision while retaining two decisions: whether the Plan is worth executing and whether the resulting evidence can be trusted as evidence about that Plan.

## Workflow

```text
idea or question
  -> adversarial Plan review
  -> [user decides whether to execute]
  -> execution inside the accepted Plan
  -> adversarial implementation-fidelity Check
  -> [user decides whether to trust, repair, re-plan, or stop]
```

The main agent carries the goal and context through the whole iteration. A temporary Plan Challenger reviews the proposal before execution; a new temporary Check Challenger reviews implementation fidelity afterward. In either review, target the strongest unresolved flaw that could change the user's pending decision rather than maximizing issue count. The main agent defends or revises, then adjudicates by evidence. Run one to three rounds, continuing only while a consequential objection and a useful next step remain.

## Plan — Decide Whether to Execute

Before execution, turn the user's question into a coherent decision argument connecting the uncertainty, the proposed test, the evidence that would distinguish its outcomes, and the downstream action. Make clear what implementation must preserve and what it may decide so the argument can be audited later. Have the Plan Challenger attack the weakest link, then present the revised argument and any unresolved objection to the user. Execute only after the user accepts it.

## Execute

Let the main agent execute directly or delegate as appropriate, resolving ordinary implementation details inside the accepted Plan. Return to Plan before changing the question or the evidence needed to answer it. Do not turn an unexpected result into implicit authority for more experiments.

## Check — Audit Plan-to-Implementation Fidelity

Before interpreting results, reconstruct how the accepted Plan became the actual implementation, surfacing important choices and deviations with reproducible evidence. Have the Check Challenger attack the strongest reason this account or the resulting attribution could be wrong. Repair defects only while the accepted Plan still authorizes the work; otherwise return to Plan. Report whether the result can be attributed to the intended implementation, then pause for the user's decision.

## Reporting

First establish the complete reasoning and evidence; then rewrite it as a self-contained causal narrative around the few judgments the user must make. Use documents and artifacts only as supporting pointers after that narrative.

## Scope

Leave provider, execution topology, Git, and directory layout to task context. Use `experiment-management` for persistent experimental artifacts.
