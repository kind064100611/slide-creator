## `slide-creator`

Uses Markdown, PDF text, Confluence content, or other user-provided material to first create and validate a source-grounded, self-contained HTML presentation. It then converts the final HTML to PowerPoint (PPTX) through `htmlToPptx`, which is based on `pptxgenjs`.

Key capabilities:

- Determines slide boundaries from the highest authored heading level among H1-H3 while preserving heading hierarchy and content ownership.
- Selects fixed layouts from the actual content structure while preserving tables, hierarchies, branches, flows, timelines, and similar relationships.
- Uses content ledgers and binding records to detect omissions, duplication, rewrites, cross-slide ownership errors, and invented content.
- Validates template contracts and page geometry, including placeholders, repeated nodes, connectors, overflow, overlap, and readability.
- Uses the `webex-dark` style by default and selects another built-in style only when the user or source metadata explicitly requests one.
- Supports explicit comparison reviews against reference HTML. The normal generation workflow does not read regression examples or review references.

Runtime requirement: `htmlToPptx` depends on `pptxgenjs`. If that conversion capability is unavailable, the workflow must stop at validated HTML and clearly report that PPTX conversion is blocked.

Example prompts:

```text
Generate a PowerPoint presentation from plan.md.
Generate this presentation using the webex-light style.
Review the generated result against the reference HTML.
```

## Repository Structure

```text
.
├── daily-brief/
│   └── SKILL.md                  # Daily Brief entry point and complete rules
└── slide-creator/
    ├── SKILL.md                  # Presentation entry point and complete workflow
    ├── assets/                   # Document shell, fixed layouts, and styles
    ├── examples/                 # Regression inputs and reference/generated outputs
    ├── references/               # Additional rules for explicit review workflows
    └── scripts/                  # Layout validation, reference comparison, and PDF extraction
```

The `SKILL.md` file in each skill directory is its formal entry point.

## Development and Validation

This repository does not provide a unified dependency manifest. Before running the scripts below, prepare the required environment: HTML validation requires Node.js and Playwright, while PDF extraction requires Python 3 and `pypdf`.

```sh
cd slide-creator

# Validate the built-in layouts
node scripts/validate_layouts.cjs

# Validate generated HTML and require every slide to declare its source owner
node scripts/validate_layouts.cjs --require-source-owner <generated.html>

# Compare candidate HTML with reference HTML for structure and content
node scripts/validate_review_records.cjs <reference.html> <candidate.html>

# Extract text and embedded images from a PDF
python scripts/extract_pdf_source.py <source.pdf> --output-dir <directory>
```
