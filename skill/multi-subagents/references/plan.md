# Planning Reference

Plan fully before reporting it, and keep artifacts together by analysis object.

## Think the plan through

First determine what problem the upcoming plan is meant to solve. Work out the few questions or analysis objects that matter, why each matters, what you propose to do, and why that approach can support a decision. Surface uncertainty only when it could change the conclusion; omit detail that does not.

## Report the plan clearly

Then reorganize the plan around the smallest useful set of questions or analysis objects the user must judge, not the order in which work will be performed. Make each one's motivation, proposed approach, rationale, and decision consequence easy to follow. Lead with this overview and place the steps and supporting detail beneath it instead of presenting them as the top-level plan.

## Keep each analysis object together

When the upcoming plan will create scripts or outputs, use each analysis object as the organizing directory and prefix peer object directories with numbers to show the planned analysis or experiment order. Within each object, prefer the smallest coherent set of parameterized scripts and one output root. Split scripts when responsibilities or execution boundaries genuinely differ, while keeping configurations, variants, runs, and summaries inside the same object.

Avoid splitting one object's variants and reruns into peer scripts and output roots while mixing different objects at the same level:

```text
study/
|-- run-quality-method-a.py
|-- run-quality-method-b.py
|-- rerun-quality-method-a.py
|-- run-efficiency.py
|-- outputs-quality-method-a/
|-- outputs-quality-method-b/
|-- outputs-quality-rerun/
`-- outputs-efficiency/
```

Instead, separate and order the objects, then keep each one's work together:

```text
study/
|-- 01-quality/
|   |-- run.py
|   |-- evaluate.py
|   |-- matrix.yaml
|   `-- outputs/
|       |-- runs/
|       `-- summary/
`-- 02-efficiency/
    |-- run.py
    |-- matrix.yaml
    `-- outputs/
        |-- runs/
        `-- summary/
```

Choose script count by coherent responsibility; represent variants and repeated runs as parameters, manifest rows, or leaves beneath the object's single output root.
