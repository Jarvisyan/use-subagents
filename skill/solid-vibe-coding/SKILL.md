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
  -> execution inside the accepted Plan
  -> adversarial Check against the accepted Plan
  -> [user decides from the Check report whether to trust, repair, re-plan, or stop]
```

The main agent carries the goal and context through the whole iteration. A temporary Plan Challenger participates in planning before execution; a new temporary Check Challenger audits the completed work afterward. Run each discussion for one to three evidence-driven rounds, continuing only while another round could change the Plan or the Check conclusion.

Before writing either report, build the complete low-level reasoning and evidence. Preserve the supporting detail needed for audit and reproduction in the document, but distill the chat report to the decision-relevant essentials. Organize both as a hierarchy of topics and subtopics rather than a flat list or chronology, connecting each topic's motivation, reasoning or evidence, limitations, and decision consequence. Make the chat self-contained for judgment, then provide exact document or artifact pointers for deeper detail.

## Plan — Choose and Design the Next Experiment

Start from the research problem and identify the gating uncertainty whose failure could make downstream experiments useless. Through debate, establish what experiment should resolve it, why its design can distinguish the relevant outcomes, how those outcomes change the next action, and the backbone—the fixed reference setup—and intended delta applied to it. Present the resulting Plan and any unresolved objection in the Plan report; execute only if the user decides to proceed.

## Execute

Execute the accepted Plan as written, directly or through delegation. Resolve ordinary implementation issues that do not change the experiment. If a blocking problem cannot be resolved within the Plan, report it to the user instead of changing the experiment silently.

## Check — Decide Whether the Result Is Trustworthy

Provide the Check Challenger with the accepted Plan, actual implementation, and experimental evidence. The Check Challenger compares the implementation with the Plan, examines how open choices were resolved, and identifies undeclared changes or evidence gaps that could make the result untrustworthy. The main agent may clarify with evidence, but Check produces findings rather than repairs: do not modify the implementation or rerun the experiment as a fix. Present the findings in the Check report, then let the user decide what comes next.
