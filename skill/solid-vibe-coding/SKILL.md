---
name: solid-vibe-coding
description: Run a research or exploratory coding iteration with minimal stepwise supervision while keeping the Plan-to-implementation path auditable. Use when one main conversational agent should carry an idea through an adversarial Plan Gate, adaptive execution, and an adversarial Check Gate, especially when plausible results could otherwise hide plan-to-code drift or unreported implementation choices.
---

# Solid Vibe Coding

## Workflow

```text
User frames one research iteration
  -> PLAN GATE: main agent proposes a Plan <-> temporary Plan Challenger attacks it
  -> user decides whether the Plan is worth executing
  -> EXECUTE: main agent executes or coordinates work inside the frozen Plan
  -> CHECK GATE: main agent maps Plan -> implementation
                 <-> new Check Challenger attacks fidelity and omissions
  -> user reviews what matched, what was concretized, and what deviated
  -> accept the evidence / bounded repair / new Plan / stop
```

The Plan Gate asks whether the proposed iteration is logically sound and decision-worthy. The Check Gate asks whether the implementation matches the accepted Plan and exposes every material choice or deviation that the Plan left unspecified. It is not primarily a gate on whether the experimental result looks good.

## Core Contract

Keep the main conversational agent responsible for the full iteration: understand the user's intent, lead both debates, execute or coordinate execution, inspect the actual evidence, adjudicate objections, and report to the user.

Use temporary Challenger subagents only at the Plan and Check Gates. Keep one Challenger through the rounds of a gate, then close it. Use a new Challenger for the other gate. Independence means a separate subagent context, not a blind review: give the Challenger the main agent's claims, reasoning, evidence, and relevant artifacts to attack.

## Shared Adversarial Contract

Use the same bounded loop at both gates:

`claim → attack → defend or revise → adjudicate`

Run at least one attack without asking the user to supervise intermediate rounds. Continue to a second or third round only when a blocking objection remains and the next exchange can add new discriminating evidence, check results, or a substantive revision. Stop early when no such objection remains, never exceed three rounds, and expose unresolved blockers at the user gate. The main agent adjudicates by evidence rather than vote.

A blocking objection must identify:

- the affected claim;
- a concrete failure mode or counterexample;
- the smallest discriminating evidence or check;
- the consequence for the user's decision.

## Plan Gate

Before debate, build a complete low-level map of the proposed iteration: motivation, claims, analysis objects, assumptions, open choices, evaluator, acceptance logic, non-goals, and the intended delta from any applicable baseline, reference implementation, or backbone. Freeze the semantic, resource and cost, authority, external-side-effect, and bounded recovery or diagnostic envelope.

The main agent presents the positive case. The Challenger attacks:

- whether the motivation, problem framing, and claims identify the right question;
- whether the design isolates the intended cause from confounders and competing explanations;
- whether open choices, implementation boundaries, and evidence paths make Plan-to-code fidelity auditable;
- whether the evaluator and acceptance logic can discriminate the relevant outcomes;
- whether those outcomes would support a real downstream decision at a justified cost and risk.

Revise the Plan when an objection is valid.

Then synthesize the debate for the user: the problem's origin, the adopted approach and why it is reasonable, the strongest objections and evidence, the resulting agreement or uncertainty, and the decision consequences. Execute only after the user accepts the Plan Gate.

## Adaptive Execution

Do not prescribe an executor or provider. The main agent may execute directly, delegate one task, or coordinate parallel subagents when the work is genuinely separable. Honor any executor or provider choice made by the user.

Execution may resolve implementation details, safe retries, and bounded defects autonomously inside the frozen envelope. Return to the Plan Gate before any action that would exceed its semantic, resource or cost, authority, external-side-effect, or recovery and diagnostic boundary.

Do not add experiments merely because a result is weak, surprising, or inconclusive. Finish the adopted iteration and present its evidence first.

## Check Gate

Before treating results as evidence for or against the idea, run the applicable reproducible checks and reconstruct the actual implementation:

- map each frozen Plan commitment to code, configuration, data flow, and runtime evidence;
- state how every deliberately open choice was concretized;
- identify every material delta from any applicable baseline, reference implementation, or backbone, plus every unplanned deviation;
- verify the mapping with the actual diff, artifacts, and check evidence;
- only then determine what the observed results support, separating implementation failure, idea evidence, and unresolved uncertainty.

Give a new Challenger the frozen Plan, actual diff or implementation, artifacts, reproducible check evidence, failures, and the main agent's fidelity account. It attacks:

- whether implementation, data flow, resolved open choices, and baseline deltas match the Plan;
- whether every material Plan-open choice and unplanned deviation has been surfaced for user review;
- whether the actual diff, inputs, checks, and runtime evidence substantiate the claimed mapping;
- whether any remaining result interpretation confuses an implementation defect or alternative explanation with evidence about the idea.

Repair bounded implementation defects when still inside the adopted contract and rerun affected checks; otherwise adjudicate the iteration and present the changed question as a candidate for a future Plan Gate.

After the debate, present the Check judgment: what matched the Plan, how open choices were resolved, what deviated or remains uncertain, and whether the results can be attributed to the intended implementation. Then pause for the user to accept the evidence, repair the implementation, re-plan, add an experiment, or stop.

## Synthesis

Produce each gate report in two passes:

1. build the complete claim, evidence, uncertainty, and consequence map;
2. reorganize it around the smallest set of judgments the user must make.

Connect the problem's origin, the main case, the Challenger's attacks, the evidence-driven revisions, the resulting consensus or unresolved disagreement, and the user's decision. The chat report must be sufficient for judgment without opening a document; use documents and artifacts afterward as exact supporting pointers.

## Scope

This skill does not prescribe Git, branches, worktrees, directory layouts, experiment schedulers, or a particular model vendor. Use `experiment-management` when persistent experimental artifacts need an information architecture.
