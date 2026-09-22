# Simple quantitative charts

Read this reference only when the source contains explicit numeric relationships that are easier to understand as a chart.

## Selection

- Use a horizontal bar chart for two to eight comparable categories or time points that share one unit and comparison basis.
- Use a pie chart for two to six non-negative parts of one explicitly identified whole.
- Do not chart identifiers, unrelated measures, ordinal labels, or values with incompatible units.
- Do not infer missing values from an image. If the source does not expose the chart title, labels, values, units, and comparison basis as text, omit the source image and use the remaining authored text.
- Prefer a table or metric layout when exact lookup matters more than relative magnitude.

## Bar chart

- Bind every displayed bar to one source value and keep the source order unless it already defines a ranking.
- Start a magnitude comparison at zero.
- When values are percentages on their natural 0-100 scale, use each source percentage directly as the bar width. Never rescale the largest observed percentage to 100%.
- For non-percentage magnitudes, use one explicit shared scale for all bars on the slide. Prefer a source-authored maximum, target, or capacity; if no meaningful scale exists, use a table or metric layout instead of inventing a normalized scale.
- Keep the exact value and unit visible next to every bar.
- Use `assets/layouts/bar-chart.html`; its bars are ordinary HTML shapes and remain editable after conversion.

## Pie chart

- Use a pie only when the values form one whole. If source percentages are supplied, they must total 100% within normal rounding tolerance. If source amounts are supplied, calculate each share from the explicit total.
- Never create an `Other` segment unless the source provides it or the explicit total proves the remainder.
- Keep every segment label, source value, unit, and calculated percentage in the editable HTML legend.
- Use `assets/layouts/pie-chart.html`. Do not generate a file or supply an image URL. `artifact_render` converts the template's declarative segment data into a self-contained SVG before HTML geometry validation and PowerPoint conversion.
- Emit two to six `.pie-chart-legend-item` elements inside the chart container. Each item must carry the same source-bound label, numeric value, and six-digit hex color that it displays:

```html
<div class="pie-chart-legend-item" data-chart-segment data-chart-label="SaaS" data-chart-value="45" data-chart-color="#2d9cff">
  <span class="pie-chart-swatch" style="background:#2d9cff"></span><span>SaaS</span><strong>45%</strong>
</div>
```

- Set `PIE_SEPARATOR_COLOR` to a six-digit hex color with sufficient contrast against the slide background. The preprocessing layer validates segment count, labels, values, colors, and positive total; invalid declarations fail before conversion.
- The generated pie artwork is rasterized by the current HTML-to-PPTX converter and is not editable by segment. The title, legend, values, and notes remain editable.

Example segment data:

```json
{
  "segments": [
    {"label": "SaaS", "value": 45, "color": "#2d9cff"},
    {"label": "Hardware", "value": 35, "color": "#ffb64b"},
    {"label": "Services", "value": 20, "color": "#4bd99b"}
  ],
  "separatorColor": "#050912"
}
```
