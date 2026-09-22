# Slide-to-Slide Fidelity Review

Use this review to decide whether a candidate slide deck is genuinely similar to an authoritative reference deck. The two artifacts may use different formats, including PDF, HTML, PPTX, or rendered page images. Treat the reference as the source of truth and the candidate as the artifact under review.

When the reference is already a lowered-fidelity standard HTML used for later PPTX validation, treat it as the minimum acceptable structural baseline. A generated HTML or PPTX may differ in theme, but it must not be structurally weaker than that standard.

This is a structural and visual fidelity review, not a raw pixel-equality test. Format-specific rendering, font rasterization, antialiasing, and theme substitution may differ without changing the authored composition.

When the task or product contract explicitly authorizes a named target theme (for example, `webex-dark`) that differs from the reference theme, do not classify the authorized light/dark canvas switch, palette mapping, or theme-standard rail by itself as a mismatch. Compare visual **roles** after theme normalization: neutral canvases remain neutral canvases, ordinary panels remain ordinary panels, local accent strips remain local accents, and source-emphasized filled regions remain emphasized filled regions. The authorization does not permit new dominant slabs, demoted emphasis, changed topology, or degraded hierarchy.

The default generation contract is `webex-dark`. Unless the user or source metadata explicitly names another style, a generated HTML or PPTX with a light canvas is a **Major** mismatch even when the reference is a light PDF or standard HTML. In that case normalize the reference palette only for role comparison; do not copy its light theme into the candidate. Theme normalization never waives layout, density, alignment, topology, or content checks.

## Normalize the comparison

Render both artifacts into one image per slide before judging visual fidelity.

- Use the same aspect ratio, viewport, and output dimensions for both renderings.
- Render the complete deck, not selected sample pages.
- Pair slides by source order and heading. Never hide a mismatch by reordering pages.
- Treat page-count differences, duplicated pages, and missing pages as failures unless the reference explicitly marks an optional page.
- When source text or object structure is available, use it to confirm wording, numbers, grouping, and relationships; do not rely on OCR or image similarity alone.
- Compare visible facts as an atomic ledger, not just as a bag of keywords. A metric duplicated into both a headline and note, an invented slot-filling label, a footer sentence copied into a body list, or a sibling metric promoted into a governing/root role is a Major mismatch even when every source word still appears somewhere.
- For generated-PPTX review against standard HTML, row/list alignment, connector endpoints, node separation, hierarchy depth, visual mass, and footer placement may not degrade relative to the standard.

Contact sheets and thumbnail grids are navigation aids only. They may identify suspect pages, but they cannot qualify a slide or deck because they hide missing labels, weak emphasis, connector defects, and large internal dead zones.

For every paired slide, derive one review result directly from the two current artifacts before assigning a verdict. The result must contain:

- the paired page numbers, title, and page role;
- the reference and candidate dominant regions, their orientation, and their cardinality;
- the reference and candidate meaningful-content top edge, bottom edge, and largest internal blank interval;
- for every large semantic container, the leaf-content bounding box, largest local internal blank interval, local meaningful-content density, and text-scale-to-container ratio;
- for every large semantic container, both bounding-box coverage **and summed leaf-content area ratio**; never let one item near the top and one near the bottom make a mostly empty panel appear occupied;
- a ten-band vertical occupancy vector for the page and for each large container, marking which deciles contain meaningful leaf content rather than background shells;
- for every repeated peer group, the reference and candidate item aspect ratios, heights, internal alignment, and density range;
- for every repeated peer group, the top and bottom bounds of each heading and value row, the number of rendered lines in each short label, and the maximum baseline drift among peers;
- the connector count and intended endpoints when connectors exist;
- a connector edge ledger keyed by `(source node, target node, direction)`, including every visible shaft/head object and every CSS pseudo-element that contributes to that edge;
- the style signature for the page: color scheme, canvas/panel brightness, accent placement, accent-filled area ratio, and the visual role of every large text-bearing surface;
- a semantic content ledger extracted from the underlying artifacts when available: ordered text runs, numbers and signs, named nodes, list/table rows, connector labels, source-owner or section label, and object count by role; record an explicit `not extractable` state instead of assuming rendered presence;
- missing, merged, invented, or de-emphasized source-owned content;
- the severity, primary root-cause class, and the rendered image paths used as evidence.

Review each pair at a readable full-slide scale. A missing derived page result means that page is **unreviewed**; one unreviewed page prevents deck qualification. A contact sheet or a single similarity score cannot substitute for these page results.

### Qualification evidence contract

A prose table or sentence such as `Pass: content preserved` is a conclusion, not review evidence. A deck may be reported as `fidelity-qualified` only after the current reference and candidate artifacts are compared directly:

```text
node scripts/validate_review_records.cjs <reference.html> <candidate.html>
```

The validator must render and inspect both HTML files itself. It must derive page counts, ordered visible text, exact numeric/sign/unit tokens, hierarchy, semantic containers, peer cardinality, meaningful occupancy, local dead space, connector presence, and candidate template conformance from the artifacts. It must not accept a caller-authored verdict, delta list, page count, bounds record, screenshot path, or review manifest as evidence.

The candidate's `data-layout` value is only a claim that selects the canonical contract to check. A page fails when it merely carries a valid layout name but does not instantiate that template's canonical DOM skeleton and canonical `style[data-layout-style]` CSS. Copying a few class names, replacing the template CSS, placing layout-scoped rules in a global style block, or building a custom card grid under a valid label is a **Blocker**.

For every canonical `data-layout-repeat` collection, compare the container tag/class, declared count, direct-child item tag/class, and ordered required role classes against the selected template. Missing the repeat marker, lying about its count, inserting a different child schema, merging required roles, or using the layout label around ad-hoc repeated markup is a **Blocker**. This check applies during ordinary structural validation and does not require a reference HTML.

The validator writes its derived JSON result to stdout and returns a failing exit code for any Blocker or Major finding. It does not write sidecar manifests, generation records, or review declarations into `examples/`. A saved report is optional external review output, never a generation input and never a substitute for rerunning the comparison after either HTML file changes. The report hashes both artifacts so an earlier result cannot qualify a later artifact.

If a previous report contains Pass rows based on a hand-written manifest, a layout-only lint, a contact sheet, or a prose assertion, withdraw those rows as `unreviewed`; do not grandfather them. The direct validator supplements the required full-slide visual judgment; it does not replace it.

For PPTX-to-HTML validation, render the PPTX to page images through the available presentation renderer and render each HTML `.slide` at the same 16:9 dimensions. Also extract the PPTX's native slide text and object inventory and the HTML's visible text and semantic nodes. Pair these ledgers by page before visual comparison. Rendered similarity cannot compensate for missing native text, a merged section owner, a dropped node, or an invented label.

For every PPTX page, the content ledger must additionally report four explicit deltas against its paired reference page: `reference-only items`, `candidate-only items`, `changed exact tokens`, and `changed grouping/parent ownership`. Each entry must identify the native PPTX shape or text run and the corresponding HTML node when one exists. A page cannot pass while any unexplained delta remains; a deck-level text dump, aggregate word count, or statement that “all main content is present” is not sufficient.

Before any visual scoring, build a page-owner and template-topology ledger for both files. Each row must include page index, source-owner title, page role, chosen/found template, region topology, repeated-node cardinality, connector count, and normalized visible text. Stop and mark the deck **Blocker** when page counts or owner sequences differ; do not continue with a partial visual sample and do not report a pass. A template is wrong when another fixed catalog skeleton matches the reference topology more exactly, even if the candidate retains most words.

Run `validate_layouts.cjs --require-source-owner` on the generated candidate and on canonical layout fixtures, not on a reference HTML that predates the canonical `data-layout` / `data-source-owner` contract. The reference remains authoritative for visible content and topology but is not required to carry generation metadata.

When the reference is a standard HTML deck and the candidate is a generated PPTX, treat the standard HTML as the minimum accepted composition. The PPTX may differ in theme-level details, but it must not be structurally worse than the standard HTML: no lost regions, weaker connectors, larger unreclaimed blank areas, shifted agenda/list balance, merged peer nodes, or degraded visual hierarchy.

When a standard HTML deck was intentionally simplified from a PDF because image input is unsupported, compare the generated HTML/PPTX against that standard HTML first. Do not require the omitted pure images, but do require the candidate to preserve or improve the standard HTML's page balance, connector geometry, item separation, and visible information density; the candidate must not introduce new drift, crooked arrows, off-center contents, or larger dead zones.

## Compare the structural signature first

For every page pair, record and preserve:

- page role and section ownership: cover, contents, divider, content, summary, or closing;
- dominant regions and their approximate width, height, alignment, and vertical occupation;
- visual hierarchy: governing node, subordinate groups, peer groups, annotations, and conclusions;
- node cardinality: distinct authored nodes stay distinct and peer nodes stay peers;
- connectors: arrows, branches, convergence, direction, sequence, and which endpoints they join;
- internal grouping: parallel items inside one parent remain separate child nodes rather than being flattened into a sentence;
- quantitative structure: metric groups, scales, tables, comparison columns, units, qualifiers, and visual encodings;
- content density and empty-space distribution, including whether meaningful content fills the same broad top, middle, and bottom bands;
- every unique source fact, label, number, time, conclusion, action, and relationship.

Match relationship structure before visual decoration. A generic card grid is not similar to a hierarchy, process, timeline, comparison, or branch diagram merely because it contains the same words.

Treat each page as one fixed composition, not as a collection of interchangeable slots. Map every reference region to exactly one candidate region and verify its role, order, orientation, and parent-child relationship. In particular, distinguish:

- one horizontal row from one vertical stack or a two-by-two grid;
- a central hub with surrounding spokes from a top-down tree;
- a full-width lead band from a side callout;
- sequential items from parallel peer items;
- a branch, convergence, or feedback loop from an unconnected card group.
- page-level metadata in a header from a narrative lead band in the body;
- five same-level peer cards from an invented lead/primary/supporting/conclusion decomposition;
- one featured summary plus three evidence peers in a 2×2 matrix from a full-width summary band followed by three columns.

Changing one of these structures is a blocker or major mismatch even if all words remain present. Extra panels, synthesized summaries, and merged regions are mismatches unless the reference contains the same authored role.

### Reject false-positive evidence

The following observations can never justify a pass by themselves:

- the candidate has the same number of outer cards, columns, or panels;
- every source phrase appears somewhere in the page DOM;
- the outer container bounds occupy a similar page area;
- there is no clipping, overlap, or overflow;
- a background, border, rail, or empty card reaches the bottom of the slide;
- the page has the same title and roughly the same colors;
- an arrow-like mark exists near two nodes without a continuous shaft and correct endpoints;
- a contact sheet or global similarity score looks broadly consistent.

For each large reference region, the reviewer must instead prove all of the following with the paired renders: the same authored role exists, its leaf content occupies a comparable portion of the region, its semantic children remain separate and in the same relationship, its text and metrics have comparable prominence, and its meaningful content reaches comparable vertical and horizontal bands. If this proof is absent, the region is unreviewed rather than matched.

Similarity is not a waiver for poor composition. Apply a separate absolute-quality floor after the paired comparison. A candidate fails that floor when it contains oversized low-density panels, repeated tall cards with only a heading near one edge, isolated top and bottom fragments around an empty middle, tiny text inside presentation-scale boxes, or decorative shells that dominate the meaningful content. If the reference already has a weakness, the candidate may improve it but must never amplify it. When the reference is a standard HTML used to qualify generated PPTX, any regression in leaf density, meaningful-content band coverage, card proportion, connector integrity, or text prominence is at least **Major**, even if the candidate is otherwise recognizably similar.

Presence-only matching is specifically prohibited. A candidate that preserves the card shell but reduces a dense reference card to one small heading and one line of text is a **Major** mismatch. If that treatment affects two or more peer cards or removes a relationship, it is a **Blocker**.

For template-generated output, confirm that each slide follows one fixed template skeleton. The candidate may repeat only same-kind nodes that the selected template explicitly declares as repeatable. It must not add ad-hoc sidebars, mixed card types, extra summary strips, synthetic leads, or connector systems borrowed from another template to make a page fit.

When deriving repeated peer cardinality, count only homogeneous sibling nodes that share the same semantic item signature or the selected template's declared `data-layout-repeat` group. Do not flatten a repeated group together with a following summary, banner, lead, or other different sibling and report the combined count as one peer group.

Do not treat an example's peer count as part of the fixed skeleton when the template declares that peer node repeatable. A summary-plus-evidence layout remains the same layout with three, four, or another source-authored number of homogeneous evidence cards. Review that the candidate emitted direct children matching the declared item tag/class and role order, preserved every card's styling, and matched the source cardinality exactly. Reject nested `<template>` fragments, embedded secondary layouts, dropped peers, capped counts, switches to a looser template only because the count changed, or a different card type for an additional item. If the expanded collection cannot meet the geometry floor, the correct outcome is a source-boundary split, not count truncation or font shrinkage.

Treat template CSS isolation as part of the fixed-skeleton contract. Every selector in a layout style block must be scoped to `.slide[data-layout="<that-layout>"]`. An unscoped selector, or a selector whose appearance depends on which other templates were loaded before or after it, is a blocker because it can silently change unrelated slides.

Treat document-style ownership as a separate hard boundary. The selected style owns the slide/canvas background, color scheme, global font, theme variables, rail, and deck-wide chrome. A layout template may control content topology and component surfaces, but it must not set a page or canvas background, global text color, global font family, or redefine theme variables. A template that copies a reference deck's light palette into a default `webex-dark` deck is a **Blocker**, even if its DOM skeleton and content cardinality are otherwise valid. Content panels must consume the selected style's semantic surface/text/accent variables rather than hard-coded reference-theme colors.

Compare connectors as logical relationship edges, not raw DOM-object counts. One edge may be represented by a visible glyph in a legacy reference and by a separate shaft plus arrowhead in the generated candidate; those are equivalent when their source, target, direction, and count match. Do not count an SVG container and its shaft/head as multiple edges. Compare repeated peer cardinality by ensuring every reference peer group has a candidate counterpart; an additional detected group is not itself a failure when it reflects a more explicit canonical wrapper around the same source-owned items and introduces no content or relationship.

Normalize numeric comparisons by semantic magnitude and inequality while checking surrounding visible text for units. Equivalent DOM segmentation such as `47` + `days` versus `47 days`, or `50–60` + `%` versus `50–60%`, must not fail. Do not require a supporting sentence to duplicate a number that is already visibly preserved in the same semantic item. Negative signs and inequality direction remain significant.

## Verify content fidelity

Confirm that the candidate preserves:

- every source-owned title, fact, number, unit, qualifier, conclusion, action, and attribution;
- every numeric sign, inequality, range delimiter, scale, and comparison direction exactly as authored; `-35%`, `<1%`, `35%+`, and `30%-45%` are not interchangeable with unsigned or reworded values;
- the original section and slide order;
- the ownership of each item by the correct slide and region;
- the source's emphasis, including primary measures, anchor conclusions, and governing nodes;
- separate peer items without accidental merging, duplication, or omission.
- authored numbering and ordinal prefixes when they identify sequence, ownership, or peer identity; do not drop them as decoration or synthesize new ones where the reference has none;
- dedicated ordinal badges must keep the number optically centered on both axes and must materialize as explicit text-bearing shapes; a visible number pinned to a badge corner is a **Major** layout defect even when the token is present;
- source-authored pills, badges, labels, and conclusion bands as distinct nodes when the reference presents them separately; inline text is not an equivalent replacement when separation carries grouping or emphasis.
- For HTML that will be materialized into PPTX, every source-owned word, number, ordinal, connector shaft, and arrowhead must exist as an explicit DOM/SVG/image node supported by the materializer. CSS `content`, `::before`, `::after`, list counters, background images, and other browser-only generated content do not count as present until the rendered PPTX proves that they survive. Loss of an authored ordinal or connector through pseudo-element materialization is a **Major** defect; loss that changes sequence or relationship is a **Blocker**.
- A repeated collection must preserve the selected slide template's declared item tag/class, role tags, role order, materialization attributes, and one-to-one cardinality. A candidate fails when it nests another template/layout, merely declares repeat metadata, merges an ordinal into a title, promotes an ordinary label to a heading, rebuilds the item with different child tags, or omits required connector/metric roles.

For each paired page, compare the semantic ledgers before accepting visual fidelity:

- every distinct reference text item must be present on the same candidate page, allowing only meaning-preserving translation or the smallest readability edit;
- every candidate text item must trace to the reference page or its source; untraceable subtitles, summaries, conclusions, labels, dates, and metrics are invented content;
- when the reference and candidate are generated from the same language source, compare visible wording verbatim after only whitespace normalization and safe HTML-entity decoding. Paraphrases, expanded explanations, inferred takeaways, and substituted labels are not fidelity matches even when they sound semantically plausible;
- compare paragraph and list-item segmentation. Splitting one reference paragraph into multiple sibling text nodes, merging separate paragraphs, or converting prose to bullets is a structural content mismatch when it changes grouping or emphasis;
- compare hard line breaks inside text runs. Candidate-only `<br>` elements or PPTX hard breaks used merely for wrapping are rendering defects; ordinary wrapping must remain renderer-driven unless the reference authors the break;
- compare exact display tokens independently from numeric meaning: `>25%` is not `25%+`, `5–8×` is not `5x–8x`, `20 hours` is not `20h+`, and `1.5×` is not `1.5x`;
- section owners may not be merged: when the reference has a divider page and a separate child-content page, one candidate page containing both titles is a missing-page blocker rather than a concise redesign;
- repeated labels, list rows, table rows, named graph nodes, and relationship labels must preserve their reference cardinality and order;
- compare inline emphasis and adjacent punctuation, not only normalized plain text. A bold prefix flattened to ordinary text, a dropped colon or separator, or an emphasized token promoted into a different region is a content-structure mismatch;
- compare authored ordinals by role. When the reference uses one dedicated index plus an unnumbered title, a candidate that repeats the same ordinal inside the title has duplicate content and is at least **Major**;
- for ordered-list agenda rows, compare the rendered index format independently from Markdown syntax. A reference `01` is not matched by `1.`; list-marker punctuation must not leak into the visible dedicated index.
- when a diagram already renders a relationship, candidate prose that merely serializes the same source-target edges is duplicate content. Count that prose region as invented/duplicated structure unless the reference also contains a separate explanatory note;
- extractable PPTX text/object data is authoritative for content completeness. OCR or a visually similar screenshot is insufficient when native content is available.

Do not accept invented subtitles, conclusions, dates, labels, owners, actions, or relationships. Equivalent translation or concise wording is acceptable only when it preserves the complete meaning and emphasis.

Dates and page-owned metadata are exact content. A one-day shift, guessed owner, altered status, or substituted count is a **Blocker**, even when the layout is otherwise similar.

Metadata placement is also structural. A year, date, reporting period, data period, unit, or source line that the reference keeps in the header may not become a body lead or standalone content card. Conversely, moving a substantive lead into header metadata is a mismatch.

When source YAML front matter declares `deck-footer`, `default-content-footer`, or exact `owner-footers`, compare the rendered footer text against that metadata. The metadata is not visible body content; rendering its keys as a panel or omitting an applicable footer value is a fidelity mismatch.

Heading level alone does not authorize invented tiers. When consecutive same-level headings remain peer cards in the reference, the candidate must not recast them as primary versus supporting groups or extract the final peer's trailing paragraph into a page-level conclusion. Treat that recast as a **Major** mismatch, or a **Blocker** when it changes page ownership or drops a peer.

## Compare geometry and visual mass

Inspect every non-divider slide as a complete page.

- Compare the bottom edge of the last meaningful text, chart, connector, or data-bearing shape.
- Compare the largest continuous empty band inside the content area.
- Compute effective occupancy from rendered text glyphs, charts, connectors, and data-bearing shapes. Background color, a border, an empty card, a panel shadow, or an oversized container does not count as occupied content.
- Compare the vertical occupancy profile of the top, middle, and bottom thirds. A candidate must not concentrate all meaningful content in one band when the reference distributes it across the page.
- Compare the horizontal occupancy profile and the centroid of meaningful content. A full-width or visually centered reference must not become a narrow left- or right-biased composition. An empty lead column, blank sidebar, or unused half-page that pushes the real content off center is a major mismatch even when every word is present.
- Compare the largest blank interval between meaningful objects, not merely the outer bounds of their containers. A full-height empty card must therefore still be reported as dead space.
- Derive meaningful occupancy from leaf content: rendered text lines, chart marks, explicit connectors, images, and data-bearing shapes. Exclude ancestor panels, card backgrounds, borders, rails, and empty containers even when they carry `data-pptx-shape`, `data-geometry-fill-body`, or `data-geometry-contain-content`.
- For every data-bearing chart, build a mark ledger that records chart type, source row count, visible mark count, sign/direction, label, and display token. A DOM row or PPTX object that exists but has zero visible width/height, transparent fill, an unmatched CSS class, or no rendered mark does not count. Any source row without a visible corresponding mark is a **Blocker**; do not accept the page because its labels or values remain visible.
- Repeat the same measurement **inside every large semantic container** (card, panel, column, flow area, table area, chart area, or callout). Whole-page occupancy cannot excuse a locally empty container. A panel whose border fills the page but whose leaf content occupies only a small strip is sparse, not filled.
- Compare the topology of empty space, not only its total area. Record where the reference has dense clusters and deliberate gaps. A candidate that moves one cluster to the top and another to the bottom while creating a new empty middle is a mismatch even when its outer content bounds equal the reference.
- Build a page-region topology signature before judging style: ordered row count, column count, row/column spans, full-width versus side-by-side regions, region roles, and role cardinality. A 2×2 matrix is not equivalent to a full-width summary band above three columns; a generic grid is not equivalent to a fixed three-over-two five-card arrangement; one merged label is not equivalent to a three-token signature. A different topology is a template-selection **Blocker** when it changes ownership or node count, otherwise at least **Major**.
- Compare summed visible leaf area as well as the leaf bounding box. Two small clusters placed at opposite extremes can produce a tall bounding box while using almost none of the container; this is still severe dead space.
- Compare the ten-band occupancy vectors. An occupied top decile and bottom decile do not compensate for six or more empty middle deciles when the reference has a compact continuous cluster.
- Compare repeated-card scale as a first-class structural property. Card height, width, aspect ratio, padding, and internal alignment should remain in the same broad proportions as the reference. Turning compact agenda or evidence cards into tall empty frames is a major mismatch.
- Treat separator topology as authored structure. When a metric strip has one divider between a lead metric and a grouped set of peer facts, the candidate must render exactly that one divider; repeating the divider on every peer fact changes the grouping and is at least **Major**.
- Treat comparison-track length as layout geometry, not as the encoded value. A compact local bar group must not expand into a half-slide chart merely because spare horizontal space exists. Unless the reference intentionally uses a dominant plot, a comparison/bar region wider than roughly 30% of the slide is a review warning and a material expansion relative to the reference is **Major**.
- Preserve internal vertical anchors of repeated peers. A reference whose number, title, and description form one compact top/middle cluster must not become a card with the number at the top, title in the middle, and evidence or conclusion pinned to the bottom. `margin-top: auto`, flex spacers, or absolute bottom pinning are defects when they create that drift.
- Compare typography relative to its owning region. Body text, metrics, labels, and headings must retain comparable prominence relative to card height and slide size. Tiny text inside oversized containers is a major mismatch even when all wording is present.
- Treat related title, metric, label, explanation, and evidence as one visual cluster. Their internal gaps should remain comparable to the reference. Do not accept mechanical distribution that breaks one semantic cluster into isolated top, middle, and bottom fragments.
- Do not use `justify-content: space-between`, `space-around`, oversized fixed heights, or equivalent positioning merely to make sparse content touch container extremes. These techniques do not increase meaningful density and must be reported when they create artificial internal voids.
- As a practical warning threshold, inspect any large container whose leaf-content bounding box uses less than roughly 35% of its height, whose largest local empty interval exceeds roughly 35% of its height, or whose height is more than roughly 1.5 times the corresponding reference region. Thresholds are triage aids; the rendered reference remains authoritative.
- If two or more peer containers trigger those warning thresholds, classify the slide as at least **Major** unless the reference contains the same empty-space pattern. If a gap separates content that should read as one group or hides a relationship, classify it as a **Blocker**.
- Even one dominant container is **Major** when its summed meaningful leaf area is below roughly 20% of its interior and the reference does not intentionally use that negative space. Two or more such peer containers make the slide a **Blocker** because the page composition has collapsed into empty frames.
- Treat a continuous dead band larger than roughly one fifth of the content area as a major mismatch unless the reference has the same deliberate negative space.
- Check region ratios, alignment, whitespace rhythm, connector endpoints, clipping, overlap, text overflow, shape distortion, and footer position.
- Do not treat whole-page `scrollWidth`/`scrollHeight` checks as proof that text fits. For every text-bearing leaf, compare its rendered glyph bounds with the padded interior of its immediate semantic owner (card, panel, node, table cell, callout, or chart label). Text that remains inside the slide but crosses its owning border, overlaps the next region, or is hidden by `overflow` is a rendering defect. Re-run this container-level check after translation because English and CJK text produce different line counts.
- Apply the same ownership check to nested shapes, not only text glyphs. Every child card, flow node, badge, chart plot, and connector must remain inside its parent's padded interior unless the reference intentionally shows an external attachment. A child border touching, crossing, or masking its parent border is an overlap failure even when all text remains readable.
- Inspect functional connectors as geometry, not as text. Horizontal and vertical connectors must stay axis-aligned, meet the intended node edges or centers, and keep a consistent shaft/head relationship. A Unicode arrow glyph used as a connector is a rendering defect because font metrics and text baselines can rotate, offset, or detach it during PPT conversion; require explicit line and arrowhead shapes instead.
- SVG `marker`, `marker-start`, `marker-mid`, and `marker-end` do not qualify as stable materialized arrowheads. Require one explicit shaft object plus one explicit arrowhead object for every logical connector, and verify the head remains present after PPTX materialization.
- Preserve the reference connector family. A smooth curved branch or fan-out path must remain a continuous smooth curve with stable tangents, an attached arrowhead, and endpoints anchored to the intended node boundaries; do not replace it with a rectilinear trunk, abrupt elbows, or separate line fragments. Connector geometry must be derived from the final rendered node bounds so text-driven resizing cannot detach or misalign the edge.
- Build an edge ledger before accepting any connector diagram. Each authored `(source, target, direction)` edge must have exactly one visible continuous path unless the reference explicitly contains parallel edges. Normalize one shaft plus its attached arrowhead into one logical edge; raw DOM/PPTX object count is diagnostic and must not misclassify that valid two-object construction as duplicate edges. Count a second shaft or second head with the same endpoints as duplication.
- When deriving the connector ledger from HTML classes, count only explicit connector semantics such as `arrow`, `connector`, `shaft`, SVG line/path/polyline, or visible arrow glyphs. Do not treat ordinary class substrings such as `header`, `headline`, or unrelated `head` text as connector arrowheads.
- Treat overlapping or near-parallel connector objects with the same source and target as a duplicate edge. A branch-local connector may meet a distinct shared trunk, but the trunk must not overlap or double the branch-local shaft. Two shafts entering the same card for one authored relationship are a **Blocker**, even when they visually merge into a thicker line.
- Treat a visibly slanted connector, a head detached from its shaft, a connector that stops in open space, or a connector attached to the wrong peer as a blocker when it changes or obscures the relationship.
- A connector represented only by an arrowhead, chevron, tiny tick, or nearby punctuation is incomplete when the reference shows a visible shaft. The shaft and head must read as one joined connector from the correct source node to the correct target node.
- The shaft must end at the arrowhead base; it must not continue through the arrowhead or leave the head sitting in the middle of the line. The arrowhead tip must land on the intended target boundary within the normal stroke tolerance. A head that overlaps the shaft interior, floats before the endpoint, crosses a shared trunk, or lands in open space is a **Blocker**.
- Inspect arrowheads at readable full-slide scale, not only in a contact sheet. Record the shaft end, head base, head tip, and target-boundary coordinates in the connector ledger whenever the edge is disputed.

## Peer alignment and concise labels

Repeated peer items establish shared rows. Compare the rendered top and bottom bounds of their titles, values, notes, and body starts. A wrapped title that pushes one peer's following content below the others is at least **Major** when the other peers remain on one line or start their next row higher.

For short categorical labels, prefer a concise meaning-preserving label that fits the established peer row. If a source label is unnecessarily long, update the Markdown/source and the standard HTML together; do not compensate by shrinking only that card's font, increasing only that card's height, forcing a hard break, or accepting misaligned downstream rows. A label may wrap only when the reference intentionally allocates the same multi-line title band to every peer.
- Do not fix empty space by stretching blank containers. Redistribute source-owned text, metrics, nodes, connectors, and conclusions, or choose a more appropriate layout.
- Do not fix empty space by scattering sparse content. Prefer a shorter container, a compact fixed-layout variant, a correctly matched template, or restoration of omitted source-owned detail. Never invent copy solely to fill a box.
- For contents and agenda pages, require the candidate to preserve the reference orientation and balance: full-width stacked rows remain full-width stacked rows; balanced agenda cards remain balanced cards; an asymmetric lead-and-list template is valid only when the source authors a meaningful lead region.
- A contents or agenda page with full-width rows must keep a stable left number band and row body alignment. Do not accept a list whose rows drift into the horizontal center/right of the page or whose index treatment changes from a row-owned block into a small detached label.

Generic HTML geometry checks are necessary but not sufficient. A page may have no overlap or overflow and still fail because its fixed skeleton, meaningful occupancy, or reading order differs from the reference.

Exact theme colors, font family, icon glyphs, shadows, antialiasing, and small spacing differences are acceptable only when hierarchy, emphasis, geometry, surface roles, and reading order remain equivalent. Theme substitution is not permission to change the visual role of a region.

Audit the selected style as a page-level signature, not as a palette label. First normalize any explicitly authorized named theme substitution; apply the checks below to role changes within the normalized target theme:

- Compare `color-scheme`, canvas and panel brightness, text contrast, border treatment, and where accent colors are allowed to appear. A slide rendered with a light canvas inside a deck explicitly using `webex-dark`, or vice versa, is at least **Major** only when that switch is not the explicitly authorized target-theme substitution. Within an authorized `webex-dark` deck, an accidentally light slide remains a mismatch.
- Compare accent-filled area and salience. Replacing a neutral panel with a full high-saturation accent fill is a visual-hierarchy inversion, not an acceptable color difference. Likewise, replacing a reference's thin top/left/right accent strip with a saturated full-surface fill changes the component role.
- Any text-bearing region covering roughly 8% or more of the slide, or more than half the slide width and roughly 8% of its height, must remain a neutral canvas/panel when the reference uses a neutral panel with a local accent strip. A full saturated blue/cyan/orange/green fill in that case is **Major**; repeated use across a deck is a systemic **Blocker**.
- A large accent-filled region is allowed only when the reference explicitly gives that region a dominant governing-node, hero-metric, or full-band role. Do not infer that role merely because the candidate has spare space or a summary sentence.
- Compare text scale to surface salience. Small body text inside a large saturated slab is a **Major** mismatch even if the wording is correct, because the surface dominates while its content is de-emphasized.

## Image-input limitation

Assume by default that the candidate-generation path does not support image input. Ignore differences caused only by omitting or replacing photographs, screenshots, illustrations, and other pure embedded images; the image pixels themselves are outside the fidelity verdict.

This exclusion does not excuse a broken composition:

- reflow the remaining source-owned content into the released space;
- do not leave a blank placeholder, empty colored panel, caption-only hole, or invented replacement copy;
- keep charts, diagrams, tables, arrows, data-bearing shapes, and text that can be reconstructed from explicit source data;
- judge those structural elements normally even when the reference happened to rasterize them as an image.

After omitting a pure image, measure the remaining meaningful-content boundary again. The released region must be reclaimed by source-owned content; an empty placeholder or a large blank band is still a blocker.

## Severity and verdict

- **Blocker:** missing, duplicated, reordered, or merged slides or authored regions; lost unique content; invented content; missing, duplicate, or incorrect connectors; changed hierarchy or direction; a systemic style-role inversion repeated across the deck; or an unreflowed image-omission hole.
- **Major:** materially different region ratios, layout family, page density, alignment, visual emphasis, or vertical use that changes how the slide is read.
- **Major also includes:** compact reference cards expanded into tall low-density frames; two or more large panels with severe local dead space; typography made materially smaller relative to its container; or semantic clusters split by artificial vertical distribution.
- **Minor:** small spacing, typography, icon, color, or rendering differences that preserve structure and emphasis.

A deck is **fidelity-qualified** only when:

- every slide is paired and reviewed;
- page count and source order match;
- no blocker remains;
- no major mismatch remains;
- generic geometry validation reports no clipping, overlap, overflow, out-of-canvas content, or displaced footer.
- every slide also clears the absolute-quality floor; similarity to an already weak reference is not sufficient, and a generated PPTX may not regress from its standard HTML baseline.

Qualification requires an actual rendered, side-by-side review of every slide pair. Sampling a few pages, relying only on DOM geometry, or treating an empty bordered region as filled does not qualify the deck.

The direct validator output must identify the findings and verdict for every page. Do not persist caller-authored review manifests or generation-consumable records beside the examples. If the output does not cover every page, report the deck as **not fully reviewed**, never as passed.

Do not reduce the verdict to one image-similarity score. A high pixel score can hide missing text or relationships, while a low score can be caused by an acceptable theme change. The structural, semantic, and geometric checks are authoritative.

## Correction loop

Classify the root cause before changing anything:

- **Source-content gap:** the reference contains source-owned text, numbers, nodes, or relationships that are absent from the input script. Restore them in the Markdown script; do not invent replacement copy in the HTML.
- **Template-selection gap:** the input contains the required structure, but the selected template has a different page skeleton, orientation, hierarchy, connector pattern, or region order. Improve `catalog.md` selection cues and choose a matching template.
- **Template-capacity gap:** the selected skeleton is correct, but a declared repeated peer group cannot hold all source-owned items. Extend only that template's explicitly repeatable same-kind node; preserve every other region, ratio, connector, and visual role.
- **Rendering defect:** the correct content and template produce clipping, overlap, distortion, broken arrows, displaced footers, or unreadable text. Fix the template geometry without changing the authored structure.
- **Template-proportion defect:** the correct skeleton and content are present, but fixed region heights, card aspect ratios, internal alignment, or typography scale create local dead zones or scattered clusters. Correct those proportions in that fixed template; do not add regions or turn it into a universal layout.

Then iterate:

1. Identify the first mismatching slide pair, classify its severity, and assign exactly one primary root-cause class above.
2. Fix only the root-cause layer while preserving source order, section ownership, wording, and facts.
3. Restore missing content, separate nodes, and explicit connectors before tuning spacing or decoration.
4. Reallocate omitted-image space to remaining source-owned content.
5. Re-render the complete candidate deck.
6. Recheck every slide pair for count, order, content, hierarchy, connector endpoints, page density, per-container density, empty-space topology, repeated-card proportions, typography scale, clipping, overlap, overflow, and footer position.
7. Verify that each page still follows one fixed template skeleton and that only template-declared peer nodes were duplicated; reject slot mixing, inserted regions, universal-template behavior, and ad-hoc composition.
8. Repeat until no blocker or major mismatch remains; do not declare fidelity complete earlier.
