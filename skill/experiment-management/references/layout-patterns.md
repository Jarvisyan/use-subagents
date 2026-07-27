# Layout Patterns

These are non-normative relationship sketches. Angle-bracketed labels name semantic roles, not required files or directories. Adapt them to the repository's conventions.

## One Object, Many Variants

Use one object when several configurations jointly answer one question.

```text
<plan>
└── <analysis-object: one claim>
    ├── <public surface>
    │   ├── <supported entry>
    │   └── <variant contract: parameters, seeds, defaults>
    ├── <internal implementation>
    ├── <checks>
    ├── <evidence surface>
    │   ├── <primary comparison and current judgment>
    │   └── <supporting diagnostics and provenance>
    └── <ephemeral scratch: caches and regenerable intermediates>
```

Core user-facing material is the supported entry, variant contract, primary comparison, and judgment. Helpers and checks are internal; logs, raw measurements, and failed attempts are supporting; caches and regenerable intermediates remain outside the evidence surface.

Avoid this:

```text
<analysis-object>
├── run_baseline
├── run_variant_a
├── run_variant_b
├── run_seed_1
├── run_seed_2
├── retry_variant_b
├── helper
├── evaluator
└── many peer output folders
```

This layout turns implementation history into the public interface and forces the user to reconstruct the intended comparison.

## One Object, Several Real Subexperiments

One question may require several distinct execution entries, such as a qualification test and a downstream stress test, while still producing one combined judgment.

```text
<analysis-object: one combined claim>
├── <public surface>
│   ├── <entry A: subquestion and supported controls>
│   ├── <entry B: subquestion and supported controls>
│   └── <shared configuration or selector>
├── <shared internal implementation>
└── <evidence surface>
    ├── <primary result A>
    ├── <primary result B>
    └── <combined judgment>
```

Multiple entries are justified because each has a distinct user-visible purpose. Keep them together, name their questions, and avoid exposing helpers as peers.

Split them into separate analysis objects instead when either subexperiment can be judged independently or controls a separate downstream gate:

```text
<plan>
├── <analysis-object A>
│   ├── <public entry A>
│   ├── <primary evidence A>
│   └── <gate>
└── <analysis-object B, activated after the gate>
    ├── <public entry B>
    └── <primary evidence B>
```

## One Plan-Level Entry, Several Objects

A shared public entry is valid when it clearly selects among several independently judged objects:

```text
<plan>
├── <public entry: explicit object selector and shared controls>
├── <analysis-object A> -> <primary evidence A> -> <judgment A>
└── <analysis-object B> -> <primary evidence B> -> <judgment B>
```

The entry belongs to the Plan, while each object retains its own claim and evidence. Avoid requiring users to inspect internal dispatch code to discover this mapping.

## Primary Evidence Versus Artifact Ocean

Prefer:

```text
<analysis-object>
├── <evidence surface>
│   ├── <primary results: decision-ready comparisons>
│   ├── <current judgment>
│   └── <supporting evidence: protocol, diagnostics, logs, failed attempts>
└── <ephemeral scratch: regenerable intermediates and cache>
```

Avoid:

```text
<output surface>
├── attempt_001
├── attempt_002
├── seed_001
├── stage_prepare
├── stage_sample
├── stage_eval
├── cache
└── summary_somewhere
```

The second form preserves files but hides the evidence the user actually needs.

## Boundary Test

Ask:

1. Can the conclusions be stated and accepted independently?
2. Can one pass while the other fails?
3. Does either control a separate downstream decision?

If yes, separate analysis objects are usually clearer. If only parameters, agents, attempts, or processing steps differ, keep one object and record those differences as controls or provenance.

## Lazy Downstream Growth

Before a gate passes, record only the downstream question and activation condition. Do not create empty entries, result folders, or speculative helpers. If the gate fails, preserve the reason; if it passes, create the downstream object's surfaces when work starts.
