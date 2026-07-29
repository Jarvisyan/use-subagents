---
name: solid-vibe-coding
description: Use for research or exploratory coding iterations where a rough, non-trivial idea creates a large experimental search space and AI needs to choose, design, and faithfully implement the next controlled experiment before testing.
---

# Solid Vibe Coding

## Objective

Solid Vibe Coding constrains the search space at the three points where AI can drift: choosing what experiment to do next, deciding what to change relative to which backbone, and translating the accepted Plan into code. The Adversarial Workflow uses evidence-constrained debate to prioritize experiments that can eliminate an unpromising path or select a promising one, ground the backbone and isolate one target change, and verify that implementation introduces no new experimental decisions. The user retains final judgment at the Plan and Check gates. The Report Workflow makes each decision self-contained and auditable.

## Adversarial Workflow

```text
rough research idea + available project evidence
  -> adversarially choose the next experimental direction
  -> adversarially ground the backbone and isolate one target change
  -> [user decides from the Plan report whether to proceed]
  -> implement without reopening experimental choices
  -> adversarially check implementation against the accepted Plan
  -> [user decides from the Check report whether to submit, repair, re-plan, or stop]
  -> submit the checked experiment for testing
```

### Adversarial Plan

Use evidence-constrained debate to constrain the large search space of a rough research idea before coding. The main agent proposes both the experimental direction and design, grounded in the research goal, available project evidence, and task constraints. A temporary Plan Challenger raises the strongest material countercase; the main agent must defend, revise, or concede. Stop at evidence-based consensus or after three rounds, and preserve unresolved objections for the user.

First, choose the experimental direction by prioritizing a kill-criterion experiment, whose failure would invalidate the Idea or a major downstream path, or a fork-in-the-road experiment, whose outcome would select between materially different paths. The Challenger tests whether the proposal can eliminate an unpromising path or select a promising mainline, rather than merely tune within one path.

Before defining the target change, identify and justify the backbone for this experiment. Reuse an accepted backbone when appropriate; if no candidate is sufficiently grounded, make backbone selection the next decision-critical experiment. Once selected, keep it fixed within this experiment. Define one target design change and freeze unrelated factors, including data preprocessing, losses, training hyperparameters, and evaluation protocol. Fix in the Plan every choice that could alter the intended comparison or attribution; only implementation details that cannot alter either may use disclosed defaults.

Have the Challenger test whether a more decision-critical experiment should come first, whether the backbone is sufficiently justified, whether the design changes more than one factor, and whether any choice that could materially affect comparison or attribution has been left to implementation.

### Adversarial Coding

Implement the accepted Plan without reopening its experimental choices. The main agent may decide only implementation details that cannot materially alter the intended comparison or attribution, and must disclose them. After implementation, use evidence-constrained debate with a new temporary Check Challenger to audit fidelity before the experiment is submitted for testing; the user retains the final decision on whether to submit it.

Have the Challenger make one consolidated comparison between the accepted Plan and the implementation. The prescribed-change check verifies that every planned change is complete, semantically correct, and active in the intended execution path. The unauthorized-change check verifies that the chosen backbone and frozen factors remain unchanged, and that coding introduced no undeclared change or conclusion-relevant decision. The main agent must defend the implementation with evidence.

If they agree that within-Plan bugs exist, repair them as one batch and perform one final re-check. Return any fix that requires a new experimental choice or changes a frozen factor to Plan rather than implementing it. Report the final conclusion, repairs, and unresolved mismatches in one Check report; submit only if the user decides to proceed.

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
