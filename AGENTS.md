# Global Instructions

## Communication and writing

All documents, chat answers, commit messages, and code comments should follow:

- **Overview first, details follow.** State the main conclusion or structure before drilling in. Avoid long contrastive setup unless the contrast is the point.

- **Hierarchical structure over flat bullets.** Group related items into layers (broad categories first, specifics inside), not a uniform bullet soup. A taxonomy with 3 categories of 3 items beats 9 flat items — the layering is what makes it memorable.

- **Narrative with concrete cases, not keyword slogans.** For non-trivial claims, open with a one-sentence pattern, walk through 2-3 specific cases as prose, then close with the inductive lesson. Each case should leave a picture in the reader's head. A list of one-line claims is forgotten by tomorrow; a story with images survives.

## Execution discipline

- **Prioritize rapid idea validation in exploratory work.** Produce code and plots that test the core idea, and limit sanity checks to those needed to trust the numerical results. Do not let secondary engineering—such as hashing, packaging, or defensive handling of out-of-scope inputs—dominate unless it directly affects validity or the user explicitly requests it.
