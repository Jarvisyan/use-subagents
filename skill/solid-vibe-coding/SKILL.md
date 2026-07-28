---
name: solid-vibe-coding
description: Use for research or exploratory coding iterations where AI should choose and design the most decision-critical next experiment, execute with minimal stepwise supervision, and adversarially check whether its implementation and result are trustworthy.
---

# Solid Vibe Coding

## Objective

Automate the research iteration without automating away judgment. Use adversarial planning to choose and design the most decision-critical next experiment: the prerequisite test whose failure could make downstream experiments useless. After execution, use adversarial checking against the accepted Plan to decide whether the result is trustworthy.

## Workflow

```text
research problem
  -> adversarially choose and design the most decision-critical experiment
  -> [user decides from the Plan report whether to proceed]
  -> implement, then adversarially check fidelity to the accepted Plan
  -> [user decides from the Check report whether to run, repair, re-plan, or stop]
  -> run the checked experiment
```

The main agent carries the goal and context through the whole iteration. Before implementation, a temporary Plan Challenger adversarially tests whether the proposed experiment is truly the most decision-critical—the prerequisite experiment on which downstream work depends—and whether its design can resolve that prerequisite. After implementation, a new temporary Check Challenger adversarially tests whether the implementation faithfully realizes the accepted Plan before it is run. Run each discussion for one to three evidence-driven rounds, continuing only while another round could change the Plan or the Check conclusion.

Use the same recursive hierarchy of key points for each chat report and its supporting document:

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

Before writing a Plan or Check report, build the complete low-level reasoning and evidence. Begin with an overview that states the overall conclusion, its key reasons, and the decision or action needed; do not make the reader synthesize the conclusion from the details. Follow with the motivation and context needed to re-enter the task: the research goal, last accepted state, what has since been done or learned, and why it matters now. Then organize what needs to be reported into distinct decision-relevant key points, decompose each into subpoints, and recurse only as needed. For every point, give a connected account of the proposal or finding, reasoning or evidence, limitations, and decision consequence, adding enough local context to make the point intelligible. These are not headings or checklist fields, but parts of a coherent narrative. Preserve the supporting detail needed for audit and reproduction in the document, but distill the chat report to the decision-relevant essentials. The chat report may compress evidentiary depth, but not the narrative or decision chain: make it self-contained for judgment without requiring the reader to reconstruct context from earlier messages or documents, then provide exact document or artifact pointers for deeper detail.

## Plan — Choose and Design the Next Experiment

Start from the research problem and identify the gating uncertainty whose failure could make downstream experiments useless. Through debate, establish what experiment should resolve it, why its design can distinguish the relevant outcomes, how those outcomes change the next action, and the backbone—the fixed reference setup—and intended delta applied to it. Present the resulting Plan and any unresolved objection in the Plan report; execute only if the user decides to proceed.

## Execute

Execute the accepted Plan as written, directly or through delegation. Resolve ordinary implementation issues that do not change the experiment. If a blocking problem cannot be resolved within the Plan, report it to the user instead of changing the experiment silently.

## Check — Decide Whether the Result Is Trustworthy

Provide the Check Challenger with the accepted Plan, actual implementation, and experimental evidence. The Check Challenger compares the implementation with the Plan, examines how open choices were resolved, and identifies undeclared changes or evidence gaps that could make the result untrustworthy. The main agent may clarify with evidence, but Check produces findings rather than repairs: do not modify the implementation or rerun the experiment as a fix. Present the findings in the Check report, then let the user decide what comes next.
