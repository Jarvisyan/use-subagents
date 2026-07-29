# Method Writing

## Objective

Method Writing combines two adversarial workflows. Method Plan decides what the Method must explain and at what depth to keep the accepted innovation central while completely defining the method, then organizes that content to minimize the reader's cost of reconstructing it. Method Writing realizes the accepted Plan one block at a time and checks each block before the user decides whether to move on.

## Workflow

```text
fixed method, accepted innovation framing, implementation, and paper context
  -> adversarially plan the Method's content and reader path
  -> [user decides whether to accept, revise, or reject the Method Plan]
  -> progressively refine the next accepted block
  -> [user decides whether it is ready to draft]
  -> write, then adversarially check the block against its sources and Plan
  -> [user decides whether to accept, rewrite, re-plan, or stop]
  -> repeat for the next block
  -> adversarially check the complete chapter
  -> [user makes the final decision]
```

## Adversarial Method Plan

Adversarial Method Plan uses evidence-constrained debate to form an accepted writing contract for two coupled decisions: what the Method must explain and at what depth, and how readers should encounter that content. The main agent proposes, a temporary Plan Challenger raises the strongest material countercase, and the main agent must defend, revise, or concede. Stop at evidence-based consensus or after three rounds; preserve unresolved objections for the user.

Given the accepted contribution framing, decide which method information belongs in the current scope and how deeply it must be explained. For every planned block, state its concrete method obligation—the mechanism, relationship, algorithmic semantics, or source-supported design explanation it must establish—and anchor that obligation in the implementation or author-provided evidence. Explain inherited machinery only as far as needed to locate the innovation, define its interfaces, and understand the intended delta; exclude conventional machinery, engineering detail, and experimental settings unless they materially define the method. The Challenger attacks material omissions, misplaced emphasis, unsupported claims, and content that belongs elsewhere in the paper.

Organize those obligations by conceptual dependency rather than code execution or file order. Let readers establish the complete method picture before dependent details, assign each block a distinct explanatory responsibility, and choose prose, figures, equations, or pseudocode according to the information they must carry. The Challenger attacks dependency breaks, repetition, conflicting ownership, mismatched abstraction levels, and presentation choices that increase reading cost. A reference paper may supply presentation conventions and useful patterns, but must not determine this paper's content boundary or structure.

Keep the chapter-level Plan minimally sufficient: fix major block responsibilities, boundaries, dependencies, relative depth, and primary information carriers without planning every paragraph. Before drafting the current block, refine its accepted obligation into the necessary local content and a short, dependency-ordered sequence of explanatory moves in which each move makes the next intelligible. Do not prescribe sentences or paragraph counts, or change the block's chapter role, its boundary with sibling blocks, or accepted dependencies without re-planning. Draft once the block has one coherent, source-checkable responsibility; leave sentence-level wording and other reversible prose choices open.

## Adversarial Method Writing

Adversarial Method Writing realizes one accepted block and determines whether it faithfully fulfills its method obligation before the chapter advances. The main agent drafts the block, and a new temporary Writing Challenger compares it with the sources and accepted writing contract while the user retains the final decision.

The Challenger makes one consolidated attack on the most material factual contradiction, Plan deviation, or break in the local explanatory chain, identifying the earliest unsupported jump rather than merely requesting smoother transitions. The main agent must defend with evidence or revise within the accepted Plan, after which the Challenger re-checks the complete block rather than only the original finding. Continue only while another evidence-driven round could materially improve the verdict, and stop at consensus or after three rounds. Report any remaining issue or any change to the accepted scientific meaning or parent structure for the user to accept, rewrite, or re-plan rather than continuing an automatic loop.

## Whole-Chapter Check

After all blocks are accepted, adversarially check only the problems that local review could not expose: cross-block omission or repetition, dependency breaks, and inconsistent terminology, notation, interfaces, or scientific meaning. Report any material reopening of an accepted block instead of silently rewriting it, and let the user make the final decision.
