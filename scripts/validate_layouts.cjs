const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const skillRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(skillRoot, 'assets');
const layoutRoot = path.join(assetsRoot, 'layouts');

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(entryPath));
    else files.push(entryPath);
  }
  return files;
}

function read(relativePath) {
  return fs.readFileSync(path.join(assetsRoot, relativePath), 'utf8');
}

function splitLayout(name) {
  const content = read(`layouts/${name}.html`);
  const match = content.match(/^(?:\s|<!--[\s\S]*?-->)*(<style[^>]*>[\s\S]*?<\/style>)\s*([\s\S]*)$/u);
  if (!match) throw new Error(`${name}: expected one leading layout style block`);
  return { styleBlock: match[1], body: match[2] };
}

function normalizeCss(value) {
  return value.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\s+/gu, '');
}

function classRelations(value) {
  const html = value.replace(/<!--[\s\S]*?-->/gu, '');
  const stack = [];
  const relations = [];
  const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source']);
  for (const match of html.matchAll(/<(\/)?([a-z][a-z0-9-]*)\b([^>]*)>/giu)) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (closing) {
      while (stack.length && stack.at(-1).tag !== tag) stack.pop();
      stack.pop();
      continue;
    }
    const classValue = /(?:^|\s)class="([^"]+)"/u.exec(match[3])?.[1] || '';
    const classes = classValue.split(/\s+/u).filter((className) => className && !className.includes('{{'));
    const parentClass = [...stack].reverse().flatMap((entry) => entry.classes).find(Boolean) || '';
    for (const className of classes) relations.push({ className, tag, parentClass });
    if (!match[3].trimEnd().endsWith('/') && !voidTags.has(tag)) stack.push({ tag, classes });
  }
  return [...new Map(relations.map((relation) => [`${relation.className}|${relation.tag}|${relation.parentClass}`, relation])).values()];
}

function repeatContracts(value) {
  const repeats = [];
  for (const match of value.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bdata-layout-repeat="([^"]+)"[^>]*)>/giu)) {
    const attributes = match[2];
    const attribute = (name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'u').exec(attributes)?.[1] || '';
    const containerClass = attribute('class').split(/\s+/u).find((className) => className && !className.includes('{{')) || '';
    repeats.push({
      name: match[3],
      containerTag: match[1].toLowerCase(),
      containerClass,
      itemTag: attribute('data-layout-item-tag').toLowerCase(),
      itemClass: attribute('data-layout-item-class'),
      roleClasses: attribute('data-layout-item-roles').split(/\s+/u).filter(Boolean),
    });
  }
  return repeats;
}

function layoutContract(name) {
  const { styleBlock, body } = splitLayout(name);
  const styleText = /<style\b[^>]*>([\s\S]*?)<\/style>/u.exec(styleBlock)?.[1] ?? '';
  const requiredClasses = [...body.matchAll(/(?:^|\s)class="([^"]+)"/gu)]
    .flatMap((match) => match[1].split(/\s+/u))
    .filter((className) => className && !className.includes('{{'));
  return {
    requiredClasses: [...new Set(requiredClasses)],
    requiredRelations: classRelations(body),
    repeats: repeatContracts(body),
    normalizedStyle: normalizeCss(styleText),
  };
}

function fill(value, fields) {
  for (const [name, replacement] of Object.entries(fields)) value = value.replaceAll(`{{${name}}}`, replacement);
  return value.replace(/\{\{[A-Z0-9_]+\}\}/gu, '');
}

function cssRuleSelectors(cssText) {
  return [...cssText.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{/gu)]
    .map((match) => match[1].trim())
    .filter((selector) => selector && !selector.startsWith('@'));
}

function staticChecks() {
  const failures = [];
  const exampleJson = walkFiles(path.join(skillRoot, 'examples')).filter((fileName) => fileName.endsWith('.json'));
  for (const fileName of exampleJson) failures.push(`${path.relative(skillRoot, fileName)}: examples must not contain review manifests or generation records`);
  const layoutFiles = fs.readdirSync(layoutRoot).filter((name) => name.endsWith('.html')).sort();
  if (layoutFiles.length !== 19) failures.push(`catalog: expected exactly 19 slide-level layout files for the current 19-page suite, found ${layoutFiles.length}`);
  const catalog = read('layouts/catalog.md');
  const catalogRows = [...catalog.matchAll(/^\| \[[^\]]+\]\(([^)]+\.html)\) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gmu)];
  const catalogFiles = catalogRows.map((match) => match[1]).sort();
  if (new Set(catalogFiles).size !== catalogFiles.length) failures.push('catalog: duplicate layout row');
  if (catalog.includes('summary-band-three-evidence-cards')) failures.push('catalog: stale count-bound summary layout name');
  for (const fileName of layoutFiles) if (!catalogFiles.includes(fileName)) failures.push(`${fileName}: missing from catalog`);
  for (const fileName of catalogFiles) if (!layoutFiles.includes(fileName)) failures.push(`catalog: missing layout file ${fileName}`);
  for (const match of catalogRows) if (match.slice(2).some((cell) => !cell.trim())) failures.push(`${match[1]}: empty catalog decision cell`);

  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  for (const requirement of ['resolved boundary level', 'source-owner manifest', 'data-source-owner', 'routing record']) {
    if (!skill.includes(requirement)) failures.push(`SKILL.md: missing required gate: ${requirement}`);
  }
  for (const forbidden of ['adaptive-grid', 'content-flow', 'stacked-list', 'section-divider', 'title-cover', 'minimal-closing', 'metric-grid-with-flow']) {
    if (skill.includes(forbidden)) failures.push(`SKILL.md: stale deleted layout reference ${forbidden}`);
  }

  for (const fileName of layoutFiles) {
    const layoutName = path.basename(fileName, '.html');
    const content = fs.readFileSync(path.join(layoutRoot, fileName), 'utf8');
    const styles = [...content.matchAll(/<style\b[^>]*\bdata-layout-style="([^"]+)"[^>]*>/gu)].map((match) => match[1]);
    const slides = [...content.matchAll(/<section\b[^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*\bdata-layout="([^"]+)"[^>]*>/gu)].map((match) => match[1]);
    if (styles.length !== 1 || styles[0] !== layoutName) failures.push(`${fileName}: data-layout-style must equal ${layoutName}`);
    if (slides.length !== 1 || slides[0] !== layoutName) failures.push(`${fileName}: slide data-layout must equal ${layoutName}`);
    const styleBody = /<style\b[^>]*>([\s\S]*?)<\/style>/u.exec(content)?.[1] ?? '';
    const requiredScope = `.slide[data-layout="${layoutName}"]`;
    for (const rule of styleBody.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const selectorGroup = rule[1].trim();
      const declarations = rule[2];
      for (const selector of selectorGroup.split(',').map((item) => item.trim()).filter(Boolean)) {
        if (!selector.startsWith(requiredScope)) failures.push(`${fileName}: unscoped selector ${selector}`);
        if (selector === requiredScope && /(?:^|;)\s*(?:background(?:-color|-image)?|color|font-family|--[\w-]+)\s*:/iu.test(declarations)) {
          failures.push(`${fileName}: layout root must not override the document style or theme variables`);
        }
        const canvasSelector = `${requiredScope} .canvas`;
        const targetsCanvas = selector === canvasSelector || (selector.startsWith(canvasSelector) && /^[.:#\[]/u.test(selector.slice(canvasSelector.length)));
        if (targetsCanvas && /(?:^|;)\s*(?:background(?:-color|-image)?|color|font-family|--[\w-]+)\s*:/iu.test(declarations)) {
          failures.push(`${fileName}: canvas theme belongs to the selected document style, not the layout template`);
        }
      }
    }
    if (!/<article class="[^"]*\bcanvas\b/u.test(content)) failures.push(`${fileName}: missing canvas`);
    if (/<template\b|data-layout-exemplar=/iu.test(content)) failures.push(`${fileName}: nested template fragments are forbidden; one layout file must define one complete slide skeleton`);
    if (!/<footer class="deck-foot"[\s\S]*?<\/footer>\s*<\/article>\s*<\/section>\s*$/u.test(content)) failures.push(`${fileName}: footer is not final canvas child`);
    if (/content\s*:\s*["'][→←↑↓]["']/u.test(content) || /data-pptx-text[^>]*>\s*[→←↑↓]\s*</u.test(content)) {
      failures.push(`${fileName}: functional connector uses a Unicode arrow`);
    }
    if (/<marker\b/iu.test(content) || /marker-(?:start|mid|end)\s*=/iu.test(content)) {
      failures.push(`${fileName}: functional SVG connectors must use explicit shaft and arrowhead nodes, not SVG markers`);
    }
    for (const repeat of repeatContracts(content)) {
      if (!repeat.containerClass || !repeat.itemTag || !repeat.itemClass) failures.push(`${fileName}: repeat group ${repeat.name} has an incomplete canonical item contract`);
    }
  }

  const metricGrid = read('layouts/metric-grid.html');
  if (!/repeatable peer narrative paragraphs/u.test(metricGrid)
      || !/\{\{LEAD_PARAGRAPHS\}\}/u.test(metricGrid)
      || !/\{\{PRIMARY_METRIC_CARDS\}\}/u.test(metricGrid)
      || !/\{\{SECONDARY_METRIC_CARDS\}\}/u.test(metricGrid)) {
    failures.push('metric-grid: repeatable lead + primary + secondary metric contract is missing');
  }
  const flexTable = read('layouts/flex-table.html');
  if (!/class="flex-table-lead"/u.test(flexTable) || !/\{\{TABLE_BODY_ROWS\}\}/u.test(flexTable)) {
    failures.push('flex-table: lead-plus-table contract is missing');
  }
  const lossLayout = read('layouts/metric-grid-support-warning.html');
  if (!/class="loss-main"/u.test(lossLayout) || !/class="loss-main-label"/u.test(lossLayout) || !/class="loss-main-value"/u.test(lossLayout)
      || !/\{\{LOSS_FACTS\}\}/u.test(lossLayout) || !/class="loss-facts"/u.test(lossLayout) || /\{\{LOSS_MAIN\}\}|\{\{TOP_METRICS\}\}/u.test(lossLayout)) {
    failures.push('metric-grid-support-warning: the loss strip must use one loss-main plus one grouped loss-facts region');
  }
  if (/\.loss-fact\s*\{[^}]*border-(?:left|right)\s*:/u.test(lossLayout)) {
    failures.push('metric-grid-support-warning: individual loss facts must not add divider borders');
  }
  const roiLayout = read('layouts/summary-metric-peer-cards.html');
  if (!/\.roi-card\s*>\s*\.idx\s*\{[^}]*display\s*:\s*flex[^}]*align-items\s*:\s*center[^}]*justify-content\s*:\s*center/su.test(roiLayout)
      || !/data-pptx-shape data-pptx-text/u.test(roiLayout)) {
    failures.push('summary-metric-peer-cards: ordinal badges must be explicit materializable text nodes with two-axis centering');
  }
  const hierarchyLayout = read('layouts/branch-hierarchy-with-notes.html');
  if (!/branch-hierarchy-connector-path/u.test(hierarchyLayout) || !/branch-hierarchy-connector-arrowhead/u.test(hierarchyLayout) || /<marker\b|marker-(?:start|mid|end)\s*=/iu.test(hierarchyLayout)) {
    failures.push('branch-hierarchy-with-notes: every branch connector requires an explicit shaft and arrowhead contract');
  }
  const evidenceLayout = read('layouts/summary-band-evidence-cards.html');
  if (/grid-template-rows\s*:[^;]*minmax\(0,\s*1fr\)/u.test(evidenceLayout) || /summary-band-evidence-body-copy\s*\{[^}]*align-self\s*:\s*end/su.test(evidenceLayout)) {
    failures.push('summary-band-evidence-cards: evidence copy must remain in the natural content flow instead of being pinned below a dead middle band');
  }
  if (!/summary-band-evidence-highlight/u.test(evidenceLayout) || !/data-layout-item-roles="[^"]*summary-band-evidence-highlight/u.test(evidenceLayout)) {
    failures.push('summary-band-evidence-cards: label, value, and caption require one canonical highlight group');
  }
  const rowSummaryLayout = read('layouts/card-row-summary.html');
  if (!/card-row-summary-index\s*\{[^}]*display\s*:\s*inline-flex[^}]*align-items\s*:\s*center[^}]*justify-content\s*:\s*center/su.test(rowSummaryLayout)
      || !/data-pptx-shape and data-pptx-text/u.test(rowSummaryLayout)) {
    failures.push('card-row-summary: source-authored ordinals require centered materializable badge nodes');
  }
  const responseLayout = read('layouts/card-flow-target-band.html');
  if (!/response-connector-path/u.test(responseLayout) || !/response-connector-arrowhead/u.test(responseLayout)) failures.push('card-flow-target-band: stage flow requires template-owned explicit shafts and arrowheads');
  const statusLayout = read('layouts/metric-strip-chain-notes.html');
  if (!/p\.db-metric-title/u.test(statusLayout) && !/p\.db-metric-title/u.test(statusLayout.replace(/\s+/gu, ''))) failures.push('metric-strip-chain-notes: ordinary status labels must use p.db-metric-title rather than heading promotion');

  const repeatableContracts = {
    'action-plan.html': ['{{PILLS}}', '{{PLAN_CARDS}}', '{{SCORE_CARDS}}', 'repeat(auto-fit'],
    'card-row-summary.html': ['{{CARDS}}', 'repeat(auto-fit'],
    'dashboard.html': ['{{PILLS}}', '{{METRICS}}', '{{DETAIL_1_ITEMS}}', '{{DETAIL_2_ITEMS}}', 'repeat(var(--metric-count),'],
    'evidence-impact.html': ['{{PILLS}}', '{{SIGNAL_CARDS}}', '{{SEQUENCE_ITEMS}}', '{{IMPACT_CARDS}}'],
    'list-metric-note-peer-columns.html': ['{{COLUMNS}}', 'repeat(auto-fit'],
    'metric-assessment-strategy-side-stack.html': ['{{ASSESSMENT_FACTORS}}', '{{STRATEGY_CARDS}}', '{{SIDE_CARDS}}'],
    'metric-grid.html': ['{{LEAD_PARAGRAPHS}}', '{{PRIMARY_METRIC_CARDS}}', '{{SECONDARY_METRIC_CARDS}}', 'repeat(auto-fit'],
    'metric-grid-support-warning.html': ['{{LOSS_FACTS}}', '{{LOSS_CARDS}}', '{{COMPOUND_METRICS}}'],
    'metric-strip-chain-notes.html': ['{{METRICS}}', '{{FLOW_NODES}}', '{{NOTES}}'],
    'metric-summary-history-cards.html': ['{{CARDS}}'],
    'summary-band-evidence-cards.html': ['{{EVIDENCE_CARDS}}', 'data-card-count="{{CARD_COUNT}}"', 'repeat(auto-fit'],
    'summary-metric-peer-cards.html': ['{{CARDS}}'],
    'timeline-metric-chain-conclusion.html': ['{{EVENTS}}', '{{CHAIN_NODES}}'],
    'branch-hierarchy-with-notes.html': ['{{BRANCHES}}', '{{NOTES}}'],
  };
  for (const [fileName, tokens] of Object.entries(repeatableContracts)) {
    const content = read(`layouts/${fileName}`);
    for (const token of tokens) if (!content.includes(token)) failures.push(`${fileName}: repeatable-node contract is missing ${token}`);
    if (/nth-child\(\d+\)/u.test(content)) failures.push(`${fileName}: repeatable peer styling is bound to a fixed ordinal instead of a cycle`);
  }
  return failures;
}

function metricCard(title, value, note) {
  return `<article class="metric-card" data-pptx-shape data-geometry-contain-content><h2 class="metric-card-title">${title}</h2><strong class="metric-card-value">${value}</strong><p class="metric-card-note">${note}</p></article>`;
}

function dashboardMetric(value, label, note, tone = '') {
  return `<div class="dashboard-metric"><p class="dashboard-metric-value ${tone}">${value}</p><p class="dashboard-metric-label">${label}</p><p class="dashboard-metric-note">${note}</p><div class="dashboard-metric-rule ${tone}" data-pptx-shape></div></div>`;
}

function buildPriorityFixture() {
  const shell = read('document-shell.html');
  const style = read('styles/webex-dark.css');
  const names = ['dashboard', 'evidence-impact', 'action-plan', 'metric-grid', 'summary-band-evidence-cards', 'card-row-summary', 'flex-table'];
  const layouts = Object.fromEntries(names.map((name) => [name, splitLayout(name)]));
  const common = { FOOTER_NOTE: '', PAGE_COUNTER: '1 / 7', SLIDE_LABEL: 'validation', SUBTITLE: '' };
  const slides = [];

  slides.push(fill(layouts.dashboard.body, {
    ...common, SLIDE_ID: 'dashboard', TITLE: 'Account health summary', HEADER_METADATA: 'QBR review', PILLS_LABEL: 'facts', PILL_1: '47 days', PILL_2: '$340K ARR',
    CALLOUT_TITLE: 'Renewal risk', CALLOUT_BODY: 'Confidence is weakening, but the account remains recoverable.', METRIC_COUNT: '3', METRICS_LABEL: 'signals',
    PILLS: '<span class="pill" data-pptx-shape data-pptx-text>47 days</span><span class="pill" data-pptx-shape data-pptx-text>$340K ARR</span>',
    METRICS: dashboardMetric('−22%', 'Weekly users', '60 days', 'negative') + dashboardMetric('1 of 4', 'Features active', 'current') + dashboardMetric('30+ days', 'Issue age', 'no ETA'),
    COMPARISON_1_LABEL: 'Current churn', COMPARISON_1_VALUE: '6.8% q/q', COMPARISON_1_WIDTH: '6.8%', COMPARISON_2_LABEL: 'Prior churn', COMPARISON_2_VALUE: '5.1% q/q', COMPARISON_2_WIDTH: '5.1%', COMPARISON_CONTEXT: 'Quarter over quarter',
    DETAIL_1_TITLE: 'Risk drivers', DETAIL_1_ITEMS: '<li>Critical issue remains blocked.</li><li>Value proof is shallow.</li>',
    DETAIL_2_TITLE: 'Next moves', DETAIL_2_ITEMS: '<li>Assign engineering owner.</li><li>Package the ROI story.</li><li>Relaunch enablement.</li>',
  }));

  slides.push(fill(layouts['evidence-impact'].body, {
    ...common, SLIDE_ID: 'evidence-impact', TITLE: 'Risk evidence and impact',
    SIGNALS_LABEL: 'signals', SIGNAL_COUNT: '3', SIGNAL_CARDS: ['Engagement', 'Product value', 'Delivery confidence'].map((title, index) => `<article class="evidence-signal" data-pptx-shape><span class="evidence-kicker">0${index + 1}</span><h2 class="evidence-signal-title">${title}</h2><strong class="evidence-value">${['−22%', '1 of 4', '30+ days'][index]}</strong><p class="evidence-signal-copy">Evidence</p></article>`).join(''),
    SEQUENCE_TITLE: 'Evidence timeline', SEQUENCE_COUNT: '4', SEQUENCE_ITEMS: ['30+ days', '9 days', 'Finance call', 'Now'].map((label) => `<div class="evidence-sequence-item"><strong class="evidence-sequence-label">${label}</strong><p class="evidence-sequence-copy">Evidence item.</p></div>`).join(''),
    IMPACT_TITLE: 'Likely renewal impact', IMPACT_COUNT: '3', IMPACT_CARDS: ['Budget scrutiny', 'Pilot stalls', 'Trust erodes'].map((title) => `<div class="evidence-impact" data-pptx-shape><strong class="evidence-impact-title">${title}</strong><span class="evidence-impact-copy">Impact evidence.</span></div>`).join(''),
  }));

  const planFields = { ...common, SLIDE_ID: 'action-plan', TITLE: 'Renewal recovery plan', PLAN_LABEL: 'workstreams', PLAN_COUNT: '3', SCORECARD_STATUS: 'Measures', SCORECARD_TITLE: 'Recovery scorecard', SCORECARD_BODY: '<p>Confirm restored confidence.</p>', SCORE_COUNT: '4' };
  planFields.PLAN_CARDS = ['Unblock trust', 'Prove value', 'Rebuild usage'].map((title, index) => `<article class="plan-card" data-pptx-shape data-geometry-contain-content><span class="plan-kicker">${['Now', 'Next 7 days', 'Before QBR'][index]}</span><h2 class="plan-title">${title}</h2><ol class="plan-actions"><li>Name an accountable owner.</li><li>Confirm the measurable outcome.</li><li>Track the follow-up.</li></ol><span class="plan-owner">Suggested owner</span></article>`).join('');
  planFields.SCORE_CARDS = ['ETA', '>1 of 4', '5 users', '100%'].map((value) => `<div class="plan-score" data-pptx-shape><strong class="plan-score-value">${value}</strong><span class="plan-score-label">Checkpoint</span></div>`).join('');
  slides.push(fill(layouts['action-plan'].body, planFields));

  slides.push(fill(layouts['metric-grid'].body, {
    ...common, SLIDE_ID: 'metric-grid', TITLE: 'Hardware cost inflation', LEAD_TITLE: 'Buy now and lock in prices', LEAD_PARAGRAPHS: '<p>Prices remain near a three-year low.</p><p>Delay creates material cost risk.</p>', PRIMARY_CARD_COUNT: '3', SECONDARY_CARD_COUNT: '4',
    PRIMARY_METRIC_CARDS: metricCard('Mainstream SSD', '+132%', 'RMB 410 to RMB 950') + metricCard('DDR5 kit', '+300%', 'RMB 450 to RMB 1,800') + metricCard('DDR5 memory', '+322%', 'Spot-price increase'),
    SECONDARY_METRIC_CARDS: metricCard('Forecast', '+316%', 'DRAM and NAND') + metricCard('Storage share', '>60%', 'System cost') + metricCard('System price', '+90%', 'Margin protection') + metricCard('Cost of delay', '+35%', 'Budget exposure'),
  }));

  const evidenceCards = Array.from({ length: 4 }, (_, index) => `<article class="summary-band-evidence-card"><div class="summary-card-heading"><span class="summary-card-index" data-pptx-shape data-pptx-text>0${index + 1}</span><h2 class="summary-card-title">Evidence ${index + 1}</h2></div><div class="summary-band-evidence-highlight"><span class="summary-band-evidence-label">Source label</span><strong class="summary-band-evidence-value">${index + 1}x</strong><span class="summary-band-evidence-caption">Caption</span></div><p class="summary-band-evidence-body-copy">Explanation remains inside the repeated card.</p></article>`).join('');
  slides.push(fill(layouts['summary-band-evidence-cards'].body, {
    ...common, SLIDE_ID: 'summary-band-evidence-cards', TITLE: 'Decision window', EYEBROW: '', HEADER_META: '', SUMMARY_TITLE: 'Act in the current window', SUMMARY_BODY: 'One authored narrative summary.', SUMMARY_LABEL: 'Estimated saving', SUMMARY_VALUE: '8', SUMMARY_UNIT: 'million RMB', CARD_COUNT: '4', EVIDENCE_CARDS: evidenceCards,
  }));

  const summaryCards = Array.from({ length: 4 }, (_, index) => `<article class="card-row-summary-card" data-pptx-shape data-geometry-contain-content><span class="card-row-summary-index" data-pptx-shape data-pptx-text>0${index + 1}</span><h2 class="card-row-summary-card-title">Response ${index + 1}</h2><div class="card-row-summary-card-content"><ul><li>Action one.</li><li>Action two.</li></ul></div></article>`).join('');
  slides.push(fill(layouts['card-row-summary'].body, { ...common, SLIDE_ID: 'card-row-summary', TITLE: 'Risk response', CARD_COUNT: '4', CARDS: summaryCards, SUMMARY_LABEL: 'Summary', SUMMARY_BODY: 'Forward-looking measures reduce uncertainty.' }));

  const headers = ['Category', 'Assumption', 'Conservative', 'Neutral', 'Optimistic'].map((value) => `<th data-pptx-shape><p>${value}</p></th>`).join('');
  const rows = Array.from({ length: 5 }, (_, row) => `<tr class="flex-table-row"><th data-pptx-shape><p>Row ${row + 1}</p></th>${Array.from({ length: 4 }, (_, column) => `<td data-pptx-shape><p>Scenario ${column + 1}</p></td>`).join('')}</tr>`).join('');
  slides.push(fill(layouts['flex-table'].body, { ...common, SLIDE_ID: 'flex-table', TITLE: 'ROI model', LEAD_TITLE: 'Core financial conclusion', LEAD_BODY: 'The conservative case maintains positive cash flow.', TABLE_LABEL: 'ROI assumptions', COLUMN_COUNT: '5', ROW_COUNT: '5', TABLE_HEAD_CELLS: headers, TABLE_BODY_ROWS: rows }));

  return fill(shell, {
    DOCUMENT_LANG: 'en', DOCUMENT_TITLE: 'Priority layout validation', STYLE_CSS: style,
    LAYOUT_STYLE_BLOCKS: names.map((name) => layouts[name].styleBlock).join('\n'), PRESENTATION_LABEL: 'validation', SLIDES: slides.join('\n'),
  });
}

async function renderedChecks(page, html, sourceLabel, { requireSourceOwner = false } = {}) {
  const failures = [];
  if (/<template\b|data-layout-exemplar=/iu.test(html)) failures.push(`${sourceLabel}: generated HTML contains a nested template fragment`);
  const declaredLayouts = [...html.matchAll(/<section\b[^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*\bdata-layout="([^"]+)"/gu)].map((match) => match[1]);
  const plainStyleBlocks = [...html.matchAll(/<style(?![^>]*\bdata-layout-style=)[^>]*>([\s\S]*?)<\/style>/gu)].map((match) => match[1]);
  for (const layout of new Set(declaredLayouts)) {
    const escapedLayout = layout.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    if (plainStyleBlocks.some((styleText) => new RegExp(`\\.${escapedLayout}-`, 'u').test(styleText))) {
      failures.push(`${sourceLabel}: ${layout} layout-specific CSS must come from its canonical data-layout-style block, not a plain global style`);
    }
  }
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  const layoutNames = fs.readdirSync(layoutRoot).filter((name) => name.endsWith('.html')).map((name) => path.basename(name, '.html'));
  const knownLayouts = new Set(layoutNames);
  const contracts = Object.fromEntries(layoutNames.map((name) => [name, layoutContract(name)]));
  const result = await page.evaluate(({ sourceLabel, requireSourceOwner, knownLayouts, contracts }) => {
    const failures = [];
    const rect = (element) => element.getBoundingClientRect();
    const slides = [...document.querySelectorAll('.slide')];
    if (!slides.length) failures.push(`${sourceLabel}: no slides`);
    const owners = [];
    for (const [index, slide] of slides.entries()) {
      const layout = slide.dataset.layout;
      if (!layout || !knownLayouts.includes(layout)) failures.push(`${sourceLabel}: slide ${index + 1} has unknown layout ${layout || 'missing'}`);
      const contract = contracts[layout];
      if (contract) {
        const layoutStyles = [...document.querySelectorAll(`style[data-layout-style="${layout}"]`)];
        if (layoutStyles.length !== 1) {
          failures.push(`${sourceLabel}: slide ${index + 1} must load exactly one canonical ${layout} style block`);
        } else {
          const normalizedStyle = layoutStyles[0].textContent.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\s+/gu, '');
          if (normalizedStyle !== contract.normalizedStyle) failures.push(`${sourceLabel}: slide ${index + 1} ${layout} style differs from the canonical template`);
        }
        for (const className of contract.requiredClasses) {
          if (!slide.classList.contains(className) && !slide.querySelector(`.${className}`)) {
            failures.push(`${sourceLabel}: slide ${index + 1} declares ${layout} but is missing canonical skeleton class .${className}`);
          }
        }
        for (const relation of contract.requiredRelations) {
          const matches = relation.className === 'slide' && slide.classList.contains('slide') ? [slide] : [...slide.querySelectorAll(`.${relation.className}`)];
          const nested = matches.some((element) => element.tagName.toLowerCase() === relation.tag && (!relation.parentClass || element.parentElement?.closest(`.${relation.parentClass}`)));
          if (!nested) failures.push(`${sourceLabel}: slide ${index + 1} .${relation.className} does not match canonical ${relation.tag}${relation.parentClass ? ` nesting under .${relation.parentClass}` : ''}`);
        }
        for (const repeat of contract.repeats) {
          const groups = [...slide.querySelectorAll(`[data-layout-repeat="${repeat.name}"]`)];
          if (groups.length !== 1) {
            failures.push(`${sourceLabel}: slide ${index + 1} expected exactly one canonical repeat group ${repeat.name}`);
            continue;
          }
          const group = groups[0];
          if (group.tagName.toLowerCase() !== repeat.containerTag || (repeat.containerClass && !group.classList.contains(repeat.containerClass))) failures.push(`${sourceLabel}: slide ${index + 1} repeat group ${repeat.name} container differs from canonical template`);
          const items = [...group.children].filter((child) => child.tagName !== 'TEMPLATE');
          const declared = Number(group.dataset.layoutCount);
          if (!Number.isInteger(declared) || declared !== items.length) failures.push(`${sourceLabel}: slide ${index + 1} repeat group ${repeat.name} count ${group.dataset.layoutCount || 'missing'} does not match ${items.length} rendered items`);
          for (const [itemIndex, item] of items.entries()) {
            if (item.tagName.toLowerCase() !== repeat.itemTag || !item.classList.contains(repeat.itemClass)) {
              failures.push(`${sourceLabel}: slide ${index + 1} repeat group ${repeat.name} item ${itemIndex + 1} is not canonical ${repeat.itemTag}.${repeat.itemClass}`);
              continue;
            }
            let lastRoleIndex = -1;
            const descendants = [...item.querySelectorAll('*')];
            for (const roleClass of repeat.roleClasses) {
              const matches = descendants.map((element, indexValue) => ({ element, indexValue })).filter(({ element }) => element.classList.contains(roleClass));
              if (matches.length !== 1) failures.push(`${sourceLabel}: slide ${index + 1} repeat group ${repeat.name} item ${itemIndex + 1} requires exactly one .${roleClass}`);
              else if (matches[0].indexValue <= lastRoleIndex) failures.push(`${sourceLabel}: slide ${index + 1} repeat group ${repeat.name} item ${itemIndex + 1} role .${roleClass} is out of canonical order`);
              else lastRoleIndex = matches[0].indexValue;
            }
          }
        }
      }
      if (requireSourceOwner && !slide.dataset.sourceOwner) failures.push(`${sourceLabel}: slide ${index + 1} is missing data-source-owner`);
      if (slide.dataset.sourceOwner) owners.push(slide.dataset.sourceOwner);
      const slideRect = rect(slide);
      for (const element of slide.querySelectorAll('h1,h2,h3,p,li,th,td,strong,span[data-pptx-text]')) {
        if (!element.textContent?.trim()) continue;
        const elementRect = rect(element);
        if (elementRect.left < slideRect.left - 1 || elementRect.right > slideRect.right + 1 || elementRect.top < slideRect.top - 1 || elementRect.bottom > slideRect.bottom + 1) failures.push(`${sourceLabel}: slide ${index + 1} text leaves canvas`);
      }
      for (const region of slide.querySelectorAll('[data-geometry-contain-content]')) {
        const regionRect = rect(region);
        for (const element of region.querySelectorAll('h1,h2,h3,p,li,th,td,strong,span[data-pptx-text]')) {
          if (!element.textContent?.trim()) continue;
          const elementRect = rect(element);
          if (elementRect.left < regionRect.left - 2 || elementRect.right > regionRect.right + 2 || elementRect.top < regionRect.top - 2 || elementRect.bottom > regionRect.bottom + 2) failures.push(`${sourceLabel}: slide ${index + 1} content escapes ${region.className || region.tagName}`);
        }
      }
      if (layout === 'metric-grid-support-warning') {
        const main = slide.querySelector('.loss-main');
        const facts = slide.querySelector('.loss-facts');
        const factNodes = [...slide.querySelectorAll('.loss-facts > .loss-fact')];
        const mainStyle = main ? getComputedStyle(main) : null;
        const factHasDivider = factNodes.some((fact) => {
          const style = getComputedStyle(fact);
          return Number.parseFloat(style.borderLeftWidth) > 0 || Number.parseFloat(style.borderRightWidth) > 0;
        });
        if (!main || !facts || factNodes.length !== 3 || Number.parseFloat(mainStyle?.borderRightWidth || '0') <= 0 || factHasDivider) {
          failures.push(`${sourceLabel}: slide ${index + 1} loss strip must render exactly one divider between loss-main and three grouped facts`);
        }
        if (main?.querySelector('h1,h2,h3') || slide.querySelector('.warning h1,.warning h2,.warning h3')) {
          failures.push(`${sourceLabel}: slide ${index + 1} ordinary loss and warning labels must not be promoted to headings`);
        }
      }
      if (layout === 'summary-metric-peer-cards') {
        for (const badge of slide.querySelectorAll('.roi-card > .idx')) {
          const badgeRect = rect(badge);
          const range = document.createRange();
          range.selectNodeContents(badge);
          const textRect = range.getBoundingClientRect();
          const deltaX = Math.abs((badgeRect.left + badgeRect.width / 2) - (textRect.left + textRect.width / 2));
          const deltaY = Math.abs((badgeRect.top + badgeRect.height / 2) - (textRect.top + textRect.height / 2));
          if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text') || deltaX > 2 || deltaY > 2) {
            failures.push(`${sourceLabel}: slide ${index + 1} ROI ordinal is not an explicit centered materializable text node`);
          }
        }
      }
      if (layout === 'metric-assessment-strategy-side-stack') {
        for (const badge of slide.querySelectorAll('.assessment-factor > .assessment-index')) {
          const badgeRect = rect(badge);
          const range = document.createRange();
          range.selectNodeContents(badge);
          const textRect = range.getBoundingClientRect();
          const deltaX = Math.abs((badgeRect.left + badgeRect.width / 2) - (textRect.left + textRect.width / 2));
          const deltaY = Math.abs((badgeRect.top + badgeRect.height / 2) - (textRect.top + textRect.height / 2));
          if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text') || deltaX > 2 || deltaY > 2) failures.push(`${sourceLabel}: slide ${index + 1} assessment ordinal is not an explicit centered materializable text node`);
        }
      }
      if (layout === 'branch-hierarchy-with-notes') {
        const branches = slide.querySelectorAll('.branch-hierarchy-branches > .branch-hierarchy-branch').length;
        const shafts = slide.querySelectorAll('.branch-hierarchy-connectors > .branch-hierarchy-connector-path').length;
        const heads = slide.querySelectorAll('.branch-hierarchy-connectors > .branch-hierarchy-connector-arrowhead').length;
        if (!branches || shafts !== branches || heads !== branches || slide.querySelector('marker,[marker-start],[marker-mid],[marker-end]')) {
          failures.push(`${sourceLabel}: slide ${index + 1} requires one explicit connector shaft and one explicit arrowhead per branch`);
        }
        for (const head of slide.querySelectorAll('.branch-hierarchy-connectors > .branch-hierarchy-connector-arrowhead')) {
          const bounds = head.getBBox();
          if (bounds.width > .7 || bounds.height > 1.4) failures.push(`${sourceLabel}: slide ${index + 1} connector arrowhead is oversized or fan-shaped`);
        }
      }
      if (layout === 'dashboard') {
        const comparison = slide.querySelector('.dashboard-comparison');
        if (comparison && rect(comparison).width > slideRect.width * .25) {
          failures.push(`${sourceLabel}: slide ${index + 1} dashboard comparison bars occupy more than 25% of the slide width`);
        }
      }
      if (layout === 'summary-band-evidence-cards') {
        for (const card of slide.querySelectorAll('.summary-band-evidence-card')) {
          const badge = card.querySelector(':scope .summary-card-index');
          const heading = card.querySelector(':scope .summary-card-heading');
          const highlight = card.querySelector(':scope > .summary-band-evidence-highlight');
          const caption = card.querySelector('.summary-band-evidence-caption');
          const bodyCopy = card.querySelector('.summary-band-evidence-body-copy');
          if (!badge || !heading || !highlight || !caption || !bodyCopy || !highlight.contains(caption)) {
            failures.push(`${sourceLabel}: slide ${index + 1} evidence card is missing its canonical highlight group`);
            continue;
          }
          if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text')) failures.push(`${sourceLabel}: slide ${index + 1} evidence-card ordinal is not a standalone materializable node`);
          const gap = rect(bodyCopy).top - rect(caption).bottom;
          if (gap > rect(card).height * .15) failures.push(`${sourceLabel}: slide ${index + 1} evidence card contains an excessive empty middle band`);
        }
      }
      if (layout === 'card-row-summary') {
        for (const badge of slide.querySelectorAll('.card-row-summary-index')) {
          const badgeRect = badge.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(badge);
          const textRect = range.getBoundingClientRect();
          const deltaX = Math.abs((badgeRect.left + badgeRect.width / 2) - (textRect.left + textRect.width / 2));
          const deltaY = Math.abs((badgeRect.top + badgeRect.height / 2) - (textRect.top + textRect.height / 2));
          if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text') || deltaX > 2 || deltaY > 2) failures.push(`${sourceLabel}: slide ${index + 1} card-row ordinal is not an explicit centered materializable text node`);
        }
      }
      if (layout === 'metric-strip-chain-notes') {
        for (const label of slide.querySelectorAll('.db-metric-title')) if (label.tagName !== 'P') failures.push(`${sourceLabel}: slide ${index + 1} ordinary status label is promoted above paragraph hierarchy`);
        const nodes = slide.querySelectorAll('.flow-steps > .flow-box').length;
        const shafts = slide.querySelectorAll('.flow-connectors > .flow-connector-path').length;
        const heads = slide.querySelectorAll('.flow-connectors > .flow-connector-arrowhead').length;
        if (nodes > 1 && (shafts !== nodes - 1 || heads !== nodes - 1)) failures.push(`${sourceLabel}: slide ${index + 1} mechanism chain requires one shaft and arrowhead between adjacent nodes`);
      }
      if (layout === 'timeline-metric-chain-conclusion') {
        const nodes = slide.querySelectorAll('.chain-nodes > .chain-node').length;
        const shafts = slide.querySelectorAll('.chain-connectors > .chain-connector-path').length;
        const heads = slide.querySelectorAll('.chain-connectors > .chain-connector-arrowhead').length;
        if (nodes > 1 && (shafts !== nodes - 1 || heads !== nodes - 1)) failures.push(`${sourceLabel}: slide ${index + 1} conclusion chain requires one shaft and arrowhead between adjacent nodes`);
      }
      if (layout === 'card-flow-target-band') {
        const cards = slide.querySelectorAll('.response-flow > .response-card').length;
        const shafts = slide.querySelectorAll('.response-connectors > .response-connector-path').length;
        const heads = slide.querySelectorAll('.response-connectors > .response-connector-arrowhead').length;
        if (cards < 2 || shafts !== cards - 1 || heads !== cards - 1) failures.push(`${sourceLabel}: slide ${index + 1} requires one explicit shaft and arrowhead between adjacent response stages`);
        for (const head of slide.querySelectorAll('.response-connectors > .response-connector-arrowhead')) {
          const bounds = head.getBBox();
          if (bounds.width > .7 || bounds.height > 1.4) failures.push(`${sourceLabel}: slide ${index + 1} response arrowhead is oversized or fan-shaped`);
        }
      }
    }
    if (owners.length !== new Set(owners).size) failures.push(`${sourceLabel}: duplicate data-source-owner`);
    const grid = document.querySelector('#metric-grid');
    if (grid) {
      for (const group of grid.querySelectorAll('.metric-grid-cards')) {
        const declared = Number(group.dataset.cardCount);
        const actual = group.querySelectorAll(':scope > .metric-card').length;
        if (!declared || declared !== actual) failures.push('metric-grid: declared repeated-node count does not match metric-card children');
      }
    }
    const table = document.querySelector('#flex-table');
    if (table && (table.querySelectorAll('thead th').length !== 5 || table.querySelectorAll('tbody tr').length !== 5 || !table.querySelector('.flex-table-lead'))) failures.push('flex-table: fixture is missing lead or 5x5 table');
    const summary = document.querySelector('#summary-band-evidence-cards');
    if (summary) {
      const group = summary.querySelector('.summary-band-evidence-cards');
      const actual = group?.querySelectorAll(':scope > .summary-band-evidence-card').length ?? 0;
      if (Number(group?.dataset.cardCount) !== 4 || actual !== 4) failures.push('summary-band-evidence-cards: four authored peer cards were not preserved');
    }
    return failures;
  }, { sourceLabel, requireSourceOwner, knownLayouts: [...knownLayouts], contracts });
  failures.push(...result);
  return failures;
}

(async () => {
  const args = process.argv.slice(2);
  const requireSourceOwner = args.includes('--require-source-owner');
  const fileNames = args.filter((value) => value !== '--require-source-owner');
  const failures = staticChecks();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  failures.push(...await renderedChecks(page, buildPriorityFixture(), 'priority fixture'));
  for (const fileName of fileNames) failures.push(...await renderedChecks(page, fs.readFileSync(path.resolve(fileName), 'utf8'), fileName, { requireSourceOwner }));
  await browser.close();
  console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
