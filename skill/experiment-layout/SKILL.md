---
name: experiment-layout
description: Use when creating or reorganizing persistent experiment directories with multiple Plans, subexperiments, scripts, or outputs.
---

# Experiment Layout

## Objective

Build a hierarchical experiment structure that makes Plans, subexperiments, scripts, and results easy for users to navigate.

## Overview

```text
docs/
├── 01plan.md
├── 01_report.md
└── ...

scripts/
├── 01_plan/
│   ├── 01_exp/
│   │   ├── 01_test.sh
│   │   ├── 02_test.sh
│   │   └── src/
│   ├── 02_exp/
│   │   ├── 01_test.sh
│   │   └── src/
│   └── ...
└── ...

outputs/
├── 01_plan/
│   ├── 01_exp/
│   │   ├── 01_res.csv
│   │   └── 02_res.csv
│   ├── 02_exp/
│   │   └── 01_res.csv
│   └── ...
└── ...
```

Plans use the first-level numbers; experiments within each Plan use local second-level numbers. When one experiment contains several tests, number its public scripts locally and mirror those numbers in the final outputs. Keep all identities stable across documentation, scripts, and outputs. The names above are generic placeholders; follow repository conventions and use short descriptive names in real projects.

Keep tests together in one `NN_exp` when they support the same conclusion; create another `NN_exp` when a test can be judged separately. Keep the numbered `.sh` test entries at the experiment root, and place their shared implementation under `src/`.

Keep only the final data outputs used to judge the Plan; explain their meaning in the Plan-level report. Omit intermediate outputs by default unless they are needed to reproduce the judgment or continue the work. Do not create directories for experiments that have not started, and do not delete existing files without the user's permission.
