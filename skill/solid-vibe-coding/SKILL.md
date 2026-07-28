---
name: solid-vibe-coding
description: Use for research or exploratory coding iterations where AI should adversarially choose and design the most decision-critical foundational experiment, verify implementation fidelity before running it, and produce self-contained, decision-ready reports.
---

# Solid Vibe Coding

## Objective

Solid Vibe Coding combines two complementary workflows. The Adversarial Workflow uses evidence-constrained debate to choose and design the most decision-critical foundational experiment and verify before it is run that the implementation faithfully realizes the accepted Plan, while preserving the user's final judgment at each gate. The Report Workflow turns the resulting conclusions, context, evidence, limitations, objections, and decisions into self-contained, decision-ready chat reports and auditable supporting documents. The sections below define the details of both workflows.

## Adversarial Workflow

```text
research problem
  -> adversarially choose and design the most decision-critical experiment
  -> [user decides from the Plan report whether to proceed]
  -> implement, then adversarially check fidelity to the accepted Plan
  -> [user decides from the Check report whether to run, repair, re-plan, or stop]
  -> run the checked experiment
```

### Adversarial Plan

Adversarial Plan uses evidence-constrained debate to choose and design the most decision-critical foundational experiment. The main agent proposes, a temporary Plan Challenger raises the strongest material countercase, and the main agent must defend, revise, or concede. Stop when they reach evidence-based consensus or after three rounds; preserve any unresolved objection for the user.

First, determine which unresolved upstream premise most directly underpins the validity or interpretation of downstream work, and which experiment should test it now. The Challenger attacks whether the candidate is truly foundational and whether a more decision-critical experiment should come first, rather than objecting for its own sake.

Then design the experiment from a fixed backbone and intended delta, distinguishing exact fixed commitments from open design choices whose values are not determined by current evidence and therefore use disclosed defaults. The Challenger tests whether the backbone, changes, and defaults are reasonable, preserve a meaningful comparison, resolve the upstream premise, and make the consequence of each outcome clear. Present the resulting consensus and unresolved objections in the Plan report; implement only if the user decides to proceed.

### Adversarial Coding

Adversarial Coding implements the accepted Plan, then uses evidence-constrained debate to determine whether the implementation faithfully realizes it before the experiment is run. A new temporary Check Challenger audits the completed implementation, while the user retains the final decision on whether to run it.

The Challenger makes one consolidated attack on material mismatches between the Plan and implementation, including fixed commitments, open design choices, fidelity to the backbone, and undeclared changes; the main agent defends with evidence. If they reach evidence-based consensus that one or more within-Plan bugs exist, the main agent repairs them as one batch, records the repairs, and enters one final adversarial re-check. Allow at most one repair-and-re-check loop; report any remaining issue or any change that would alter the Plan's agreed meaning instead of repairing again. Maintain one Check document per accepted Plan, updating it in place with agreed repairs and the final re-check rather than creating separate check and re-check reports. Present the conclusion and unresolved objections in the Check report, and run only if the user decides to proceed.

## Report Workflow

```text
report
  -> overview
       (overall conclusion, key reasons, and decision or action needed)
  -> motivation and context
       (research goal, last accepted state, what has since been done or learned,
        and why it matters now)
  -> key point A
       -> subpoint A1
            -> lower-level point ...
       -> subpoint A2
  -> key point B
       -> subpoint B1
       -> subpoint B2
  -> ...
```

Report Workflow makes every chat report and supporting document immediately readable and self-contained for judgment. Both follow the structure above: the chat distills the decision-relevant essentials, while the document preserves supporting detail for audit and reproduction. The chat may compress evidentiary depth, but not the narrative or decision chain, so the reader never has to reconstruct the context or synthesize the conclusion alone.

Before writing, build the complete low-level reasoning and evidence. Begin with an overview stating the overall conclusion, key reasons, and decision or action needed; follow with enough motivation and context to re-enter the task; then organize what must be reported into distinct key points and recursively nested subpoints. Within each point, connect the proposal or finding to its reasoning or evidence, limitations, decision consequence, and any local context needed to understand it. These are parts of a coherent narrative, not checklist fields. When a report follows adversarial debate, report its material products rather than its turn-by-turn transcript: the strongest material objection, the response, whether it was rejected, led to a revision or repair, or remains unresolved, and how that disposition affects the decision. Keep the chat self-contained, then provide exact document or artifact pointers for deeper detail.
