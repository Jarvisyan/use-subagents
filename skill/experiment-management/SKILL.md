---
name: experiment-management
description: Design or repair the information architecture of persistent experiments so a user can quickly find each question, public execution surface, primary evidence, and current judgment. Use when planning, implementing, reporting, resuming, or cleaning experiments whose scripts, outputs, logs, variants, or retries risk becoming a file ocean.
---

# Experiment Management

## Objective

Make the experiment legible to a user who did not produce its files. At a glance, they should be able to answer:

1. What questions are being tested?
2. Where are the supported execution entries?
3. Which outputs are the primary evidence?
4. What is the current judgment and next gate?

Organize persistent state around decisions, not around the chronology of commands.

## Model the Experiment

A **Plan** coordinates one or more related **analysis objects**. An analysis object is the smallest question or claim that can be judged independently.

Create a separate object when evidence can support a distinct conclusion or gate. Keep seeds, parameter variants, retries, agents, and ordinary processing stages inside the same object unless they change what is being judged.

Inspect and reuse repository conventions before proposing a layout. These rules define semantic roles, not required directory names, file names, or execution frameworks.

## Design in Two Passes

First, inventory the low-level workflow: entry commands, helpers, variants, inputs, outputs, evaluator steps, logs, caches, reports, and lifecycle dependencies.

Then reorganize it for user judgment. Provide an orientation surface for the Plan and expose, for every active analysis object:

- its question and status;
- its supported execution surface;
- its primary evidence surface;
- its current judgment and downstream gate.

The visible structure should explain itself without requiring the user to read internal code or reconstruct a run history.

Supported execution surfaces may belong to the Plan, an object, or both. A shared Plan-level entry must map its selections to the relevant objects and evidence; it must not hide object identity inside implementation code.

## Separate Artifact Roles

Keep these roles distinguishable even when the repository implements them in shared physical files:

- **public controls** — supported entries, configuration, and concise operating guidance;
- **internal implementation** — helpers and orchestration behind those entries;
- **primary evidence** — the smallest authoritative result needed for the decision;
- **supporting evidence** — diagnostics, detailed measurements, provenance, and failed attempts;
- **ephemeral scratch** — caches and disposable intermediates outside the official evidence chain and evidence surface.

A Plan or object may expose several entries when they represent genuinely different supported uses or subexperiments. Present those entries together at the relevant public surface, map each to the questions it serves, and share configuration or implementation where appropriate. Do not create a new entry merely for every parameter, seed, retry, or processing step.

Keep the code path and evidence path for the same object visibly corresponding. Parameterize systematic variants rather than copying scripts or output structures.

## Control Growth

Declare downstream objects and gates in the Plan, but create their operational files only after the prerequisite gate passes and work actually begins.

Preserve enough provenance to reproduce a judgment, but do not give protocols, logs, caches, diagnostics, and failed attempts the same prominence as primary results. Reconcile plans, reports, logs, and stale artifacts at meaningful iteration boundaries. Never delete material without verifying scope and authority.

## Validate the Architecture

Before accepting a design or reorganization, confirm that:

- each active object has a directly discoverable question, entry, evidence surface, and judgment;
- users do not need internal helpers or chronological logs to find the main path;
- independently judged claims are not collapsed, while variants and retries are not fragmented;
- core results remain prominent and supporting artifacts remain traceable;
- inactive downstream work has not produced a sea of empty scaffolding.

Read `references/layout-patterns.md` when designing or reviewing a non-trivial layout. Treat its trees as semantic examples, never as a mandatory topology.
