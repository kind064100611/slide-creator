# Slide Creator Examples

These examples are regression inputs and generated outputs, not runtime prompt material. `slide-creator` must not read them while creating an unrelated deck.

Formal example inputs are English Markdown files. For examples extracted from source PDFs, the base `.html` file is a page-for-page English visual reference reconstructed directly from the PDF with editable HTML text, tables, cards, nodes, and connectors. It contains no PDF screenshots or source-page images. The base HTML is a comparison golden, not a `slide-creator` template output and must not be passed to the deck-contract validator. Files suffixed with `-generated.html` are generated outputs that may be checked against the paired visual reference.

- `NorthStar/` contains three H2-owned slides and exercises dashboard evidence, evidence-to-impact structure, and an accountable recovery plan.
- `CoreTradingCapacity/` contains five H1-owned slides and exercises a lead plus seven metrics, lead-plus-evidence cards, two peer tiers, a four-card summary, and a lead-plus-table page.
- `Double11Incident/` contains six H1-owned slides and exercises a timestamped timeline, quantified evidence, root-cause peers, a mechanism chain, control targets, and nested rapid-response steps.
- `HRAnnualStrategy/` contains three H1-owned slides and exercises a metric/assessment/strategy/sidebar structure, three evidence-value-direction columns, and a summary band over three evidence cards.
- `RevenueOKR/` contains two H1-owned slides and exercises quantified evidence/context plus a side-root deployment map with exactly one connector per branch.

For every generated example, resolve the highest authored heading level among H1-H3 and require one slide owner per heading at that level: CoreTradingCapacity 5, Double11Incident 6, HRAnnualStrategy 3, NorthStar 3, and RevenueOKR 2. Lower-level headings remain regions inside their owner. Verify that all visible claims come from the paired input, every relationship keeps distinct nodes and the exact connector count, and no fact is duplicated as decoration. Compare regenerated HTML/PPTX with the paired reference document for content, ordering, hierarchy, relationship semantics, and page composition; visual style may follow the requested deck-wide style.
