# Worked Planning Example

This PBMC sampler case illustrates the planning reference; it is not a project template.

## Failure

The first report flattened seven actions, hiding what each action was meant to solve and how it would help. Grouping them under aspect labels improved the surface structure but still read like a list. A later version named a direction without explaining the backbone, comparison, or unit of analysis, so the user still could not judge whether the proposed tests were worth running.

## Correction

The parent question was which sampler configuration should become the practical backbone. Under it, the report needed only two analysis objects: `n_real inference` and `K4 x S256 rollout`.

For `n_real inference`, the motivation was to reduce sampling cost without losing reliable quality. The plan compared `T20/uniform/g1` with the current reference under the same checkpoint, PBMC split, contexts, metrics, and repeated seeds. Matching those conditions made the comparison informative: passing the declared quality margin would support replacement, while donor-level instability would keep the reference.

For `K4 x S256 rollout`, the motivation was to learn whether that saving survived the actual rollout workload. Testing the candidate and reference under the same rollout budget and evaluation made the result decision-relevant: stable quality at lower cost would support adoption, while a rollout-specific regression would reject it even if isolated inference looked acceptable.

## Directory

Reuse the same object names for entry points and outputs:

```text
current/
|-- n-real-inference/run.py
`-- k4-s256-rollout/run.py
outputs/
|-- n-real-inference/
`-- k4-s256-rollout/
```

Each `run.py` accepts related variants as parameters, and each output root keeps that object's runs and summaries together.
