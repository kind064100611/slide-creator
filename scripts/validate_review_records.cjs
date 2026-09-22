const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const skillRoot = path.resolve(__dirname, '..');
const layoutRoot = path.join(skillRoot, 'assets', 'layouts');
const VIEWPORT = { width: 1920, height: 1080 };

function parseArgs(argv) {
  if (argv.length === 2 && !argv[0].startsWith('-')) return { reference: argv[0], candidate: argv[1] };
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--reference') result.reference = argv[++index];
    else if (argv[index] === '--candidate') result.candidate = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return result;
}

function die(message) {
  console.error(message);
  process.exit(2);
}

function normalizeText(value) {
  return String(value || '').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function normalizeCss(value) {
  return String(value || '').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\s+/gu, '');
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
    const containerClass = (attribute('class').split(/\s+/u).find((className) => className && !className.includes('{{'))) || '';
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

function tokens(value) {
  return normalizeText(value).toLowerCase().match(/[a-z0-9]+(?:[.'’-][a-z0-9]+)*/gu) || [];
}

function numericTokens(value) {
  return normalizeText(value).match(/[<>≤≥+−-]?\s*(?:rmb\s*)?\d+(?:[.,]\d+)*(?:\s*[-–—→]\s*\d+(?:[.,]\d+)*)?(?:\s*(?:%|x|×|m|b|k|s|min|mins|minutes|days|weeks|years|q[1-4]))?(?![a-z0-9])/giu)?.map((item) => item.replace(/\s+/gu, '').toLowerCase()) || [];
}

function multiset(items) {
  const result = new Map();
  for (const item of items) result.set(item, (result.get(item) || 0) + 1);
  return result;
}

function missingItems(expected, actual) {
  const remaining = multiset(actual);
  const missing = [];
  for (const item of expected) {
    const count = remaining.get(item) || 0;
    if (count) remaining.set(item, count - 1);
    else missing.push(item);
  }
  return missing;
}

function jaccard(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function connectorSelector() {
  return [
    '[class*="arrow"]',
    '[class*="connector"]',
    '[class*="shaft"]',
    'svg line',
    'svg path',
    'svg polyline',
  ].join(',');
}

function canonicalContracts() {
  const contracts = {};
  for (const fileName of fs.readdirSync(layoutRoot).filter((name) => name.endsWith('.html'))) {
    const name = path.basename(fileName, '.html');
    const html = fs.readFileSync(path.join(layoutRoot, fileName), 'utf8');
    const style = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/u)?.[1] || '';
    const body = html.replace(/^[\s\S]*?<\/style>/u, '');
    const classes = [...body.matchAll(/(?:^|\s)class="([^"]+)"/gu)]
      .flatMap((match) => match[1].split(/\s+/u))
      .filter((nameValue) => nameValue && !nameValue.includes('{{'));
    contracts[name] = { classes: [...new Set(classes)], relations: classRelations(body), repeats: repeatContracts(body), css: normalizeCss(style) };
  }
  return contracts;
}

async function extractDeck(browser, filePath, contracts, candidate) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.route(/^https?:/u, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(pathToFileURL(filePath).href, { waitUntil: 'load' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : image.decode().catch(() => {})));
  });
  const result = await page.evaluate(({ contracts, candidate, connectorSelector }) => {
    const clean = (value) => String(value || '').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
    const numberPattern = /[<>≤≥+−-]?\s*(?:rmb\s*)?\d+(?:[.,]\d+)*(?:\s*[-–—→]\s*\d+(?:[.,]\d+)*)?(?:\s*(?:%|x|×|m|b|k|s|min|mins|minutes|days|weeks|years|q[1-4]))?(?![a-z0-9])/giu;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 1 && rect.height > 1;
    };
    const box = (rect, slideRect) => ({
      x: (rect.left - slideRect.left) / slideRect.width,
      y: (rect.top - slideRect.top) / slideRect.height,
      width: rect.width / slideRect.width,
      height: rect.height / slideRect.height,
      right: (rect.right - slideRect.left) / slideRect.width,
      bottom: (rect.bottom - slideRect.top) / slideRect.height,
    });
    const directText = (element) => clean([...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' '));
    const nearestSurface = (element, slide) => {
      let current = element.parentElement;
      while (current && current !== slide) {
        if (!current.classList.contains('canvas')) {
          const style = getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          if ((style.borderTopWidth !== '0px' || style.borderLeftWidth !== '0px' || style.backgroundColor !== 'rgba(0, 0, 0, 0)') && rect.width * rect.height > 100) return current;
        }
        current = current.parentElement;
      }
      return null;
    };
    const ownerPath = (element, slide) => {
      const parts = [];
      let current = element;
      while (current && current !== slide && parts.length < 5) {
        const className = [...current.classList].find((name) => !['slide', 'canvas'].includes(name));
        parts.unshift(`${current.tagName.toLowerCase()}${className ? `.${className}` : ''}`);
        current = current.parentElement;
      }
      return parts.join('>');
    };
    const largestGap = (ranges, top, bottom) => {
      const clipped = ranges.map(([start, end]) => [Math.max(top, start), Math.min(bottom, end)]).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
      let cursor = top;
      let gap = 0;
      for (const [start, end] of clipped) {
        gap = Math.max(gap, start - cursor);
        cursor = Math.max(cursor, end);
      }
      return Math.max(gap, bottom - cursor) / Math.max(1, bottom - top);
    };
    const styleMap = [...document.querySelectorAll('style[data-layout-style]')].reduce((map, style) => {
      const name = style.dataset.layoutStyle;
      (map[name] ||= []).push(style.textContent || '');
      return map;
    }, {});
    return [...document.querySelectorAll('.slide')].map((slide, index) => {
      const slideRect = slide.getBoundingClientRect();
      const textRuns = [];
      const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const element = node.parentElement;
          if (!element || element.closest('style,script,.deck-foot,[aria-hidden="true"]') || !clean(node.textContent) || !visible(element)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const element = node.parentElement;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
        if (!rects.length) continue;
        const union = rects.reduce((acc, rect) => ({ left: Math.min(acc.left, rect.left), top: Math.min(acc.top, rect.top), right: Math.max(acc.right, rect.right), bottom: Math.max(acc.bottom, rect.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        union.width = union.right - union.left;
        union.height = union.bottom - union.top;
        const style = getComputedStyle(element);
        const text = clean(node.textContent);
        const surface = nearestSurface(element, slide);
        const surfaceRect = surface?.getBoundingClientRect();
        const escapeTolerance = 6;
        const escapesSurface = Boolean(surfaceRect && (union.left < surfaceRect.left - escapeTolerance || union.right > surfaceRect.right + escapeTolerance || union.top < surfaceRect.top - escapeTolerance || union.bottom > surfaceRect.bottom + escapeTolerance));
        textRuns.push({ text, tag: element.tagName.toLowerCase(), owner: ownerPath(element, slide), fontSize: parseFloat(style.fontSize), fontWeight: parseInt(style.fontWeight, 10) || 400, box: box(union, slideRect), numerics: text.match(numberPattern) || [], escapesSurface, surfaceRole: surface ? ownerPath(surface, slide) : '' });
      }
      const leafRanges = textRuns.map((run) => [run.box.y, run.box.bottom]);
      const occupancy = Array.from({ length: 10 }, (_, band) => leafRanges.some(([top, bottom]) => bottom > band / 10 && top < (band + 1) / 10));
      const semanticElements = [...slide.querySelectorAll('article,section,aside,table,ul,ol,div')].filter((element) => {
        if (!visible(element) || element === slide || element.classList.contains('canvas') || element.closest('.deck-foot')) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const surfaced = style.borderTopWidth !== '0px' || style.borderLeftWidth !== '0px' || style.backgroundColor !== 'rgba(0, 0, 0, 0)';
        return surfaced && rect.width * rect.height >= slideRect.width * slideRect.height * 0.025;
      });
      const containers = semanticElements.map((element) => {
        const rect = element.getBoundingClientRect();
        const elementBox = box(rect, slideRect);
        const leaves = textRuns.filter((run) => run.box.x >= elementBox.x - .003 && run.box.right <= elementBox.right + .003 && run.box.y >= elementBox.y - .003 && run.box.bottom <= elementBox.bottom + .003);
        if (!leaves.length) return null;
        const top = Math.min(...leaves.map((run) => run.box.y));
        const bottom = Math.max(...leaves.map((run) => run.box.bottom));
        const heightCoverage = (bottom - top) / Math.max(.001, elementBox.height);
        const localRanges = leaves.map((run) => [run.box.y * slideRect.height, run.box.bottom * slideRect.height]);
        const prominentMetrics = leaves.filter((run) => run.numerics.length && run.fontSize >= 24).length;
        return { role: ownerPath(element, slide), box: elementBox, textCount: leaves.length, heightCoverage, largestBlank: largestGap(localRanges, rect.top - slideRect.top, rect.bottom - slideRect.top), prominentMetrics };
      }).filter(Boolean);
      const transparentRepeatGroups = new WeakSet();
      const childSignature = (child) => `${child.tagName}.${[...child.classList].sort().join('.')}`;
      const peerGroupFor = (parent, children) => {
        if (children.length < 2) return null;
        const signatures = children.map(childSignature);
        const common = signatures.filter((signature) => signature === signatures[0]).length;
        if (common !== children.length) return null;
        const rects = children.map((child) => box(child.getBoundingClientRect(), slideRect));
        return { role: ownerPath(parent, slide), count: children.length, rows: new Set(rects.map((rect) => Math.round(rect.y * 20))).size, columns: new Set(rects.map((rect) => Math.round(rect.x * 20))).size };
      };
      const directPeerGroups = [...slide.querySelectorAll('div,section,article')].map((parent) => {
        if (parent.classList.contains('canvas') || transparentRepeatGroups.has(parent)) return null;
        const children = [...parent.children].filter((child) => {
          if (!visible(child) || !['ARTICLE', 'DIV', 'LI', 'SECTION', 'SPAN'].includes(child.tagName)) return false;
          if (child.tagName !== 'SPAN') return true;
          const rect = child.getBoundingClientRect();
          return child.classList.length > 0 && rect.width * rect.height >= slideRect.width * slideRect.height * .001;
        });
        if (parent.hasAttribute('data-layout-repeat')) {
          if (children.length < 2) return null;
          const rects = children.map((child) => box(child.getBoundingClientRect(), slideRect));
          return { role: ownerPath(parent, slide), count: children.length, rows: new Set(rects.map((rect) => Math.round(rect.y * 20))).size, columns: new Set(rects.map((rect) => Math.round(rect.x * 20))).size };
        }
        if (children.length >= 2) {
          const flattened = children.flatMap((child) => child.hasAttribute('data-layout-repeat') ? [...child.children].filter((item) => item.tagName !== 'TEMPLATE' && visible(item)) : [child]);
          const flattenedGroup = flattened.length !== children.length ? peerGroupFor(parent, flattened) : null;
          if (flattenedGroup) {
            for (const child of children) if (child.hasAttribute('data-layout-repeat')) transparentRepeatGroups.add(child);
            return flattenedGroup;
          }
        }
        return peerGroupFor(parent, children);
      }).filter(Boolean);
      const layout = slide.dataset.layout || '';
      const contract = contracts[layout];
      const classSet = new Set([slide, ...slide.querySelectorAll('*')].flatMap((element) => [...element.classList]));
      const contractFailures = [];
      if (candidate) {
        if (!contract) contractFailures.push(`unknown or missing data-layout: ${layout || 'missing'}`);
        else {
          const styles = styleMap[layout] || [];
          if (styles.length !== 1) contractFailures.push(`expected exactly one canonical style[data-layout-style="${layout}"]`);
          else if (styles[0].replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\s+/gu, '') !== contract.css) contractFailures.push(`layout CSS differs from canonical ${layout}`);
          for (const className of contract.classes) if (!classSet.has(className)) contractFailures.push(`missing canonical skeleton class .${className}`);
          for (const relation of contract.relations) {
            const matches = relation.className === 'slide' && slide.classList.contains('slide') ? [slide] : [...slide.querySelectorAll(`.${relation.className}`)];
            const nested = matches.some((element) => element.tagName.toLowerCase() === relation.tag && (!relation.parentClass || element.parentElement?.closest(`.${relation.parentClass}`)));
            if (!nested) contractFailures.push(`.${relation.className} does not match canonical ${relation.tag}${relation.parentClass ? ` nesting under .${relation.parentClass}` : ''}`);
          }
          for (const repeat of contract.repeats) {
            const groups = [...slide.querySelectorAll(`[data-layout-repeat="${repeat.name}"]`)];
            if (groups.length !== 1) {
              contractFailures.push(`expected exactly one canonical repeat group ${repeat.name}`);
              continue;
            }
            const group = groups[0];
            if (group.tagName.toLowerCase() !== repeat.containerTag || (repeat.containerClass && !group.classList.contains(repeat.containerClass))) contractFailures.push(`repeat group ${repeat.name} container differs from canonical template`);
            const items = [...group.children].filter((child) => child.tagName !== 'TEMPLATE');
            const declared = Number(group.dataset.layoutCount);
            if (!Number.isInteger(declared) || declared !== items.length) contractFailures.push(`repeat group ${repeat.name} count ${group.dataset.layoutCount || 'missing'} does not match ${items.length} rendered items`);
            for (const [itemIndex, item] of items.entries()) {
              if (item.tagName.toLowerCase() !== repeat.itemTag || !item.classList.contains(repeat.itemClass)) {
                contractFailures.push(`repeat group ${repeat.name} item ${itemIndex + 1} is not canonical ${repeat.itemTag}.${repeat.itemClass}`);
                continue;
              }
              let lastRoleIndex = -1;
              const descendants = [...item.querySelectorAll('*')];
              for (const roleClass of repeat.roleClasses) {
                const matches = descendants.map((element, indexValue) => ({ element, indexValue })).filter(({ element }) => element.classList.contains(roleClass));
                if (matches.length !== 1) contractFailures.push(`repeat group ${repeat.name} item ${itemIndex + 1} requires exactly one .${roleClass}`);
                else if (matches[0].indexValue <= lastRoleIndex) contractFailures.push(`repeat group ${repeat.name} item ${itemIndex + 1} role .${roleClass} is out of canonical order`);
                else lastRoleIndex = matches[0].indexValue;
              }
            }
          }
          if (slide.querySelector('marker,[marker-start],[marker-mid],[marker-end]')) contractFailures.push('functional connectors use unstable SVG marker arrowheads');
          if (layout === 'metric-grid-support-warning') {
            const main = slide.querySelector('.loss-main');
            const facts = slide.querySelector('.loss-facts');
            const factNodes = [...slide.querySelectorAll('.loss-facts > .loss-fact')];
            const factHasDivider = factNodes.some((fact) => {
              const style = getComputedStyle(fact);
              return Number.parseFloat(style.borderLeftWidth) > 0 || Number.parseFloat(style.borderRightWidth) > 0;
            });
            if (!main || !facts || factNodes.length !== 3 || Number.parseFloat(getComputedStyle(main).borderRightWidth) <= 0 || factHasDivider) {
              contractFailures.push('loss strip must render exactly one divider between loss-main and three grouped facts');
            }
            if (main?.querySelector('h1,h2,h3') || slide.querySelector('.warning h1,.warning h2,.warning h3')) contractFailures.push('ordinary loss and warning labels must not be promoted to headings');
          }
          if (layout === 'summary-metric-peer-cards') {
            for (const badge of slide.querySelectorAll('.roi-card > .idx')) {
              const badgeRect = badge.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(badge);
              const textRect = range.getBoundingClientRect();
              const deltaX = Math.abs((badgeRect.left + badgeRect.width / 2) - (textRect.left + textRect.width / 2));
              const deltaY = Math.abs((badgeRect.top + badgeRect.height / 2) - (textRect.top + textRect.height / 2));
              if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text') || deltaX > 2 || deltaY > 2) {
                contractFailures.push('ROI ordinal is not an explicit centered materializable text node');
              }
            }
          }
          if (layout === 'metric-assessment-strategy-side-stack') {
            for (const badge of slide.querySelectorAll('.assessment-factor > .assessment-index')) {
              const badgeRect = badge.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(badge);
              const textRect = range.getBoundingClientRect();
              const deltaX = Math.abs((badgeRect.left + badgeRect.width / 2) - (textRect.left + textRect.width / 2));
              const deltaY = Math.abs((badgeRect.top + badgeRect.height / 2) - (textRect.top + textRect.height / 2));
              if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text') || deltaX > 2 || deltaY > 2) contractFailures.push('assessment ordinal is not an explicit centered materializable text node');
            }
          }
          if (layout === 'branch-hierarchy-with-notes') {
            const branches = slide.querySelectorAll('.branch-hierarchy-branches > .branch-hierarchy-branch').length;
            const shafts = slide.querySelectorAll('.branch-hierarchy-connectors > .branch-hierarchy-connector-path').length;
            const heads = slide.querySelectorAll('.branch-hierarchy-connectors > .branch-hierarchy-connector-arrowhead').length;
            if (!branches || shafts !== branches || heads !== branches) contractFailures.push('each hub branch requires one explicit connector shaft and one explicit arrowhead');
            for (const head of slide.querySelectorAll('.branch-hierarchy-connectors > .branch-hierarchy-connector-arrowhead')) {
              const bounds = head.getBBox();
              if (bounds.width > .7 || bounds.height > 1.4) contractFailures.push('hub connector arrowhead is oversized or fan-shaped');
            }
          }
          if (layout === 'dashboard') {
            const comparison = slide.querySelector('.dashboard-comparison');
            if (comparison && comparison.getBoundingClientRect().width > slideRect.width * .25) contractFailures.push('dashboard comparison bars occupy more than 25% of the slide width');
          }
          if (layout === 'summary-band-evidence-cards') {
            for (const card of slide.querySelectorAll('.summary-band-evidence-card')) {
              const badge = card.querySelector(':scope .summary-card-index');
              const highlight = card.querySelector(':scope > .summary-band-evidence-highlight');
              const caption = card.querySelector('.summary-band-evidence-caption');
              const bodyCopy = card.querySelector('.summary-band-evidence-body-copy');
              if (!badge || !highlight || !caption || !bodyCopy || !highlight.contains(caption)) {
                contractFailures.push('evidence card is missing its canonical highlight group');
                continue;
              }
              if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text')) contractFailures.push('evidence-card ordinal is not a standalone materializable node');
              const gap = bodyCopy.getBoundingClientRect().top - caption.getBoundingClientRect().bottom;
              if (gap > card.getBoundingClientRect().height * .15) contractFailures.push('evidence card contains an excessive empty middle band');
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
              if (!badge.hasAttribute('data-pptx-shape') || !badge.hasAttribute('data-pptx-text') || deltaX > 2 || deltaY > 2) contractFailures.push('card-row ordinal is not an explicit centered materializable text node');
            }
          }
          if (layout === 'metric-strip-chain-notes') {
            for (const label of slide.querySelectorAll('.db-metric-title')) if (label.tagName !== 'P') contractFailures.push('ordinary status label is promoted above paragraph hierarchy');
            const nodes = slide.querySelectorAll('.flow-steps > .flow-box').length;
            const shafts = slide.querySelectorAll('.flow-connectors > .flow-connector-path').length;
            const heads = slide.querySelectorAll('.flow-connectors > .flow-connector-arrowhead').length;
            if (nodes > 1 && (shafts !== nodes - 1 || heads !== nodes - 1)) contractFailures.push('mechanism chain requires one shaft and arrowhead between adjacent nodes');
          }
          if (layout === 'timeline-metric-chain-conclusion') {
            const nodes = slide.querySelectorAll('.chain-nodes > .chain-node').length;
            const shafts = slide.querySelectorAll('.chain-connectors > .chain-connector-path').length;
            const heads = slide.querySelectorAll('.chain-connectors > .chain-connector-arrowhead').length;
            if (nodes > 1 && (shafts !== nodes - 1 || heads !== nodes - 1)) contractFailures.push('conclusion chain requires one shaft and arrowhead between adjacent nodes');
          }
          if (layout === 'card-flow-target-band') {
            const cards = slide.querySelectorAll('.response-flow > .response-card').length;
            const shafts = slide.querySelectorAll('.response-connectors > .response-connector-path').length;
            const heads = slide.querySelectorAll('.response-connectors > .response-connector-arrowhead').length;
            if (cards < 2 || shafts !== cards - 1 || heads !== cards - 1) contractFailures.push('response stages require one explicit shaft and arrowhead between adjacent cards');
            for (const head of slide.querySelectorAll('.response-connectors > .response-connector-arrowhead')) {
              const bounds = head.getBBox();
              if (bounds.width > .7 || bounds.height > 1.4) contractFailures.push('response connector arrowhead is oversized or fan-shaped');
            }
          }
        }
      }
      const title = clean(slide.querySelector('h1')?.textContent || '');
      const canonicalNumeric = (value) => clean(value).replace(/\s+/gu, '').toLowerCase()
        .replace(/^\+/u, '')
        .replace(/^rmb/u, '')
        .replace(/(?:%|x|×|m|b|k|s|min|mins|minutes|days|weeks|years|q[1-4])$/u, '');
      const semanticListOrdinals = [...slide.querySelectorAll('ol')].filter(visible).flatMap((list) => [...list.children].filter((item) => item.tagName === 'LI' && visible(item)).map((_, itemIndex) => String(itemIndex + 1)));
      const numerics = [...new Set([...textRuns.flatMap((run) => run.numerics).map(canonicalNumeric).filter(Boolean), ...semanticListOrdinals])];
      const footerText = clean(slide.querySelector('.deck-foot')?.textContent || '');
      const bodyText = clean([...slide.querySelectorAll('.canvas > :not(.deck-foot)')].map((element) => element.textContent).join(' '));
      const ordinalRuns = textRuns.filter((run) => /^(?:0[1-9]|1[0-9]|20)[.):]?$/u.test(run.text) || (/^(?:[1-9]|1[0-9]|20)[.):]?$/u.test(run.text) && /(?:num|index|idx|step)/iu.test(run.owner)) || /^[ivx]+[.):]$/iu.test(run.text)).map((run) => run.text.toLowerCase());
      const explicitHeads = [...slide.querySelectorAll('[class*="arrowhead"],[class*="arrow-head"]')].filter(visible).length;
      const glyphConnectors = textRuns.filter((run) => /^[→←↑↓↗↘↙↖]$/u.test(run.text)).length;
      let pseudoConnectors = 0;
      for (const element of slide.querySelectorAll('*')) {
        for (const pseudo of ['::before', '::after']) {
          const content = getComputedStyle(element, pseudo).content.replace(/^['"]|['"]$/gu, '');
          if (/^[→←↑↓↗↘↙↖]$/u.test(content) && visible(element)) pseudoConnectors += 1;
        }
      }
      const explicitPaths = [...slide.querySelectorAll('svg line,svg path,svg polyline')].filter(visible).length;
      const connectors = explicitHeads || glyphConnectors || pseudoConnectors || explicitPaths;
      return {
        page: index + 1, title, layout, sourceOwner: slide.dataset.sourceOwner || '', textRuns, footerText, bodyText,
        words: textRuns.flatMap((run) => clean(run.text).toLowerCase().match(/[a-z0-9]+(?:[.'’-][a-z0-9]+)*/gu) || []), numerics, ordinalRuns,
        occupancy, largestPageBlank: largestGap(leafRanges.map(([top, bottom]) => [top * slideRect.height, bottom * slideRect.height]), 0, slideRect.height),
        containers, peerGroups: directPeerGroups, connectors, contractFailures,
        escapedTextRuns: textRuns.filter((run) => run.escapesSurface).map((run) => ({ text: run.text, owner: run.owner, surfaceRole: run.surfaceRole })),
        prominentMetrics: textRuns.filter((run) => run.numerics.length && run.fontSize >= 24).length,
        multiMetricRuns: textRuns.filter((run) => run.numerics.length > 1).map((run) => run.text),
      };
    });
  }, { contracts, candidate, connectorSelector: connectorSelector() });
  await context.close();
  return result;
}

async function validateConnectorFixture(browser) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.setContent(`<!doctype html><html><body>
    <section class="slide">
      <header class="slide-header"><h1>Connector fixture</h1></header>
      <article class="headline-card"><h2>↑ Decorative label icon</h2></article>
      <span class="fixture-arrow"><span class="fixture-arrow-line"></span><span class="fixture-arrow-head"></span></span>
    </section>
    <style>
      .slide{width:1920px;height:1080px}
      .slide-header,.headline-card{display:block;width:400px;height:80px}
      .fixture-arrow,.fixture-arrow-line,.fixture-arrow-head{display:block;width:20px;height:20px}
    </style>
  </body></html>`, { waitUntil: 'load' });
  const count = await page.evaluate((selector) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 1 && rect.height > 1;
    };
    return [...document.querySelectorAll(selector)].filter(visible).length;
  }, connectorSelector());
  await page.close();
  if (count !== 3) throw new Error(`connector fixture expected only explicit arrow elements; got ${count}`);
}

function addFinding(findings, severity, code, message, evidence = {}) {
  findings.push({ severity, code, message, evidence });
}

function pairTextRuns(referenceRuns, candidateRuns) {
  const pairs = [];
  const unmatchedReference = new Set(referenceRuns.map((_, index) => index));
  const unmatchedCandidate = new Set(candidateRuns.map((_, index) => index));
  const normalized = (run) => normalizeText(run.text).toLowerCase();
  const isHeading = (run) => /^h[1-3]$/u.test(run.tag);
  const cost = (referenceRun, candidateRun) => {
    const tagPenalty = referenceRun.tag === candidateRun.tag ? 0 : isHeading(referenceRun) === isHeading(candidateRun) ? .12 : .45;
    const geometryPenalty = Math.abs(referenceRun.box.x - candidateRun.box.x) + Math.abs(referenceRun.box.y - candidateRun.box.y);
    const fontPenalty = Math.min(1, Math.abs(referenceRun.fontSize - candidateRun.fontSize) / Math.max(1, referenceRun.fontSize));
    return tagPenalty + geometryPenalty + fontPenalty * .25;
  };

  const exactKeys = new Set(referenceRuns.map(normalized).filter(Boolean));
  for (const key of exactKeys) {
    const referenceIndexes = [...unmatchedReference].filter((index) => normalized(referenceRuns[index]) === key);
    const candidateIndexes = [...unmatchedCandidate].filter((index) => normalized(candidateRuns[index]) === key);
    const candidates = [];
    for (const referenceIndex of referenceIndexes) {
      for (const candidateIndex of candidateIndexes) candidates.push({ referenceIndex, candidateIndex, cost: cost(referenceRuns[referenceIndex], candidateRuns[candidateIndex]) });
    }
    candidates.sort((a, b) => a.cost - b.cost || a.referenceIndex - b.referenceIndex || a.candidateIndex - b.candidateIndex);
    for (const match of candidates) {
      if (!unmatchedReference.has(match.referenceIndex) || !unmatchedCandidate.has(match.candidateIndex)) continue;
      pairs.push({ reference: referenceRuns[match.referenceIndex], candidate: candidateRuns[match.candidateIndex], score: 1 });
      unmatchedReference.delete(match.referenceIndex);
      unmatchedCandidate.delete(match.candidateIndex);
    }
  }

  const approximate = [];
  for (const referenceIndex of unmatchedReference) {
    for (const candidateIndex of unmatchedCandidate) {
      const score = jaccard(referenceRuns[referenceIndex].text, candidateRuns[candidateIndex].text);
      if (score >= .65) approximate.push({ referenceIndex, candidateIndex, score, cost: cost(referenceRuns[referenceIndex], candidateRuns[candidateIndex]) });
    }
  }
  approximate.sort((a, b) => b.score - a.score || a.cost - b.cost || a.referenceIndex - b.referenceIndex || a.candidateIndex - b.candidateIndex);
  for (const match of approximate) {
    if (!unmatchedReference.has(match.referenceIndex) || !unmatchedCandidate.has(match.candidateIndex)) continue;
    pairs.push({ reference: referenceRuns[match.referenceIndex], candidate: candidateRuns[match.candidateIndex], score: match.score });
    unmatchedReference.delete(match.referenceIndex);
    unmatchedCandidate.delete(match.candidateIndex);
  }
  return pairs;
}

function comparePage(reference, candidate) {
  const findings = [];
  if (normalizeText(reference.title).toLowerCase() !== normalizeText(candidate.title).toLowerCase()) addFinding(findings, 'blocker', 'title-mismatch', 'Page title changed.', { reference: reference.title, candidate: candidate.title });
  if (reference.sourceOwner && candidate.sourceOwner !== reference.sourceOwner) addFinding(findings, 'blocker', 'source-owner-mismatch', 'Source owner changed.', { reference: reference.sourceOwner, candidate: candidate.sourceOwner });
  for (const failure of candidate.contractFailures) addFinding(findings, 'blocker', 'template-contract', failure, { declaredLayout: candidate.layout });

  const numericMagnitude = (value) => value.replace(/^[<>≤≥−-]/u, '');
  const redundantRepresentation = (item, expected, actual) => actual.some((other) => numericMagnitude(other) === numericMagnitude(item) && expected.includes(other));
  const missingNumbers = missingItems(reference.numerics, candidate.numerics).filter((item) => !redundantRepresentation(item, reference.numerics, candidate.numerics));
  const addedNumbers = missingItems(candidate.numerics, reference.numerics).filter((item) => !redundantRepresentation(item, candidate.numerics, reference.numerics));
  if (missingNumbers.length || addedNumbers.length) addFinding(findings, 'blocker', 'numeric-token-delta', 'Exact numeric/sign/unit tokens differ.', { missing: missingNumbers, added: addedNumbers });

  const missingWords = missingItems(reference.words, candidate.words);
  const addedWords = missingItems(candidate.words, reference.words);
  const recall = reference.words.length ? 1 - missingWords.length / reference.words.length : 1;
  const precision = candidate.words.length ? 1 - addedWords.length / candidate.words.length : 1;
  if (recall < .82 || precision < .72) addFinding(findings, 'blocker', 'content-ledger-delta', 'Visible text diverges materially from the reference.', { recall, precision, missing: missingWords.slice(0, 30), added: addedWords.slice(0, 30) });
  else if (recall < .92 || precision < .88) addFinding(findings, 'major', 'content-ledger-delta', 'Visible text has unexplained omissions or additions.', { recall, precision, missing: missingWords.slice(0, 20), added: addedWords.slice(0, 20) });

  const missingOrdinals = missingItems([...new Set(reference.ordinalRuns)], [...new Set(candidate.ordinalRuns)]);
  if (missingOrdinals.length) addFinding(findings, 'major', 'ordinal-role-merged', 'Standalone authored ordinals were removed or merged into labels.', { missing: missingOrdinals });
  if (reference.footerText && normalizeText(candidate.bodyText).toLowerCase().includes(normalizeText(reference.footerText).toLowerCase())) {
    addFinding(findings, 'major', 'footer-content-duplicated', 'Reference footer content was copied into the candidate body.', { footer: reference.footerText });
  }

  for (const match of pairTextRuns(reference.textRuns, candidate.textRuns)) {
    const headingPromoted = !/^h[1-3]$/u.test(match.reference.tag) && /^h[1-3]$/u.test(match.candidate.tag);
    const scalePromoted = match.candidate.fontSize > match.reference.fontSize * 1.35 && match.candidate.fontSize - match.reference.fontSize >= 6;
    if (headingPromoted || scalePromoted) addFinding(findings, 'major', 'hierarchy-promotion', 'A reference item was promoted to a stronger title role.', { reference: match.reference.text, candidate: match.candidate.text, referenceTag: match.reference.tag, candidateTag: match.candidate.tag, referenceFont: match.reference.fontSize, candidateFont: match.candidate.fontSize });
  }

  if (candidate.largestPageBlank > Math.max(.24, reference.largestPageBlank + .1)) addFinding(findings, 'major', 'page-dead-band', 'Candidate introduces a materially larger empty page band.', { reference: reference.largestPageBlank, candidate: candidate.largestPageBlank });
  if (candidate.escapedTextRuns.length > reference.escapedTextRuns.length) addFinding(findings, 'blocker', 'text-escapes-container', 'Text crosses its immediate semantic container boundary.', { reference: reference.escapedTextRuns, candidate: candidate.escapedTextRuns });
  const sparseReference = reference.containers.filter((item) => item.heightCoverage < .35 && item.largestBlank > .35).length;
  const sparseCandidate = candidate.containers.filter((item) => item.heightCoverage < .35 && item.largestBlank > .35).length;
  if (sparseCandidate >= Math.max(2, sparseReference + 2)) addFinding(findings, 'blocker', 'repeated-sparse-containers', 'Two or more large containers have severe internal dead space.', { reference: sparseReference, candidate: sparseCandidate });
  else if (sparseCandidate > sparseReference) addFinding(findings, 'major', 'sparse-container-regression', 'A large semantic container has substantially weaker internal occupancy.', { reference: sparseReference, candidate: sparseCandidate });

  const referencePeers = reference.peerGroups.map((group) => group.count).sort((a, b) => a - b);
  const candidatePeers = candidate.peerGroups.map((group) => group.count).sort((a, b) => a - b);
  const missingPeerCounts = missingItems(referencePeers, candidatePeers);
  if (missingPeerCounts.length) addFinding(findings, 'major', 'peer-topology-delta', 'A repeated peer-group cardinality present in the reference is missing from the candidate.', { reference: referencePeers, candidate: candidatePeers, missing: missingPeerCounts });
  if (reference.connectors && candidate.connectors < reference.connectors) addFinding(findings, 'blocker', 'connector-loss', 'Visible connector objects were lost.', { reference: reference.connectors, candidate: candidate.connectors });
  if (!reference.connectors && candidate.connectors) addFinding(findings, 'blocker', 'connector-invention', 'Candidate invents relationship connectors that do not exist in the reference.', { reference: reference.connectors, candidate: candidate.connectors });
  return findings;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { die(error.message); }
  if (!args.reference || !args.candidate) die('Usage: node scripts/validate_review_records.cjs <reference.html> <candidate.html>\n   or: node scripts/validate_review_records.cjs --reference <reference.html> --candidate <candidate.html>');
  const referencePath = path.resolve(args.reference);
  const candidatePath = path.resolve(args.candidate);
  for (const [label, filePath] of [['reference', referencePath], ['candidate', candidatePath]]) {
    if (path.extname(filePath).toLowerCase() === '.json') die(`${label}: manifest input is no longer supported; pass the HTML artifact directly`);
    if (!fs.existsSync(filePath)) die(`${label}: file does not exist: ${filePath}`);
    if (path.extname(filePath).toLowerCase() !== '.html') die(`${label}: direct comparison currently requires an HTML file`);
  }
  const contracts = canonicalContracts();
  const browser = await chromium.launch({ headless: true });
  let referencePages;
  let candidatePages;
  try {
    await validateConnectorFixture(browser);
    referencePages = await extractDeck(browser, referencePath, contracts, false);
    candidatePages = await extractDeck(browser, candidatePath, contracts, true);
  } finally {
    await browser.close();
  }
  const failures = [];
  const candidateSource = fs.readFileSync(candidatePath, 'utf8');
  if (/<template\b|data-layout-exemplar=/iu.test(candidateSource)) addFinding(failures, 'blocker', 'nested-template', 'Candidate contains nested template fragments; each page must instantiate exactly one slide-level layout.');
  if (referencePages.length !== candidatePages.length) addFinding(failures, 'blocker', 'page-count', 'Page counts differ.', { reference: referencePages.length, candidate: candidatePages.length });
  const pages = [];
  for (let index = 0; index < Math.min(referencePages.length, candidatePages.length); index += 1) {
    const findings = comparePage(referencePages[index], candidatePages[index]);
    pages.push({ page: index + 1, title: referencePages[index].title, referenceLayout: referencePages[index].layout || null, candidateLayout: candidatePages[index].layout || null, verdict: findings.some((item) => ['blocker', 'major'].includes(item.severity)) ? 'failed' : 'passed', findings });
    failures.push(...findings.map((finding) => ({ page: index + 1, ...finding })));
  }
  const report = {
    status: failures.some((item) => ['blocker', 'major'].includes(item.severity)) ? 'failed' : 'passed',
    referenceArtifact: referencePath,
    candidateArtifact: candidatePath,
    referenceSha256: hashFile(referencePath),
    candidateSha256: hashFile(candidatePath),
    viewport: VIEWPORT,
    referencePageCount: referencePages.length,
    candidatePageCount: candidatePages.length,
    pages,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}

main().catch((error) => die(error.stack || error.message));
