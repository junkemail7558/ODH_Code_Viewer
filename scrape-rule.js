#!/usr/bin/env node
'use strict';

/**
 * ODH Rule Scraper
 * Converts copy-pasted Ohio Administrative Code rule text into a JS data file.
 * Usage: node scrape-rule.js
 */

const readline = require('readline');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── DATE HELPERS ────────────────────────────────────────────────────────────

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12'
};

function parseDate(str) {
  str = str.trim().replace(/\.$/, '').trim();
  // MM/DD/YYYY
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // Month DD, YYYY  or  Month DD YYYY
  m = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }
  return str; // return as-is if unparseable
}

// ─── MISC HELPERS ────────────────────────────────────────────────────────────

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ORC section IDs use dots (3749.01); OAC rule IDs use dashes (3701-31-06)
function isORC(id) {
  return /^\d+\.\d+/.test(id);
}

function ruleVarName(id) {
  if (isORC(id)) return 'ORC_' + id.replace(/[.\-]/g, '_');
  return 'RULE_' + id.replace(/-/g, '_');
}

function ruleChapter(id) {
  if (isORC(id)) return id.split('.')[0];          // "3749.01" → "3749"
  return id.split('-').slice(0, 2).join('-');       // "3701-31-06" → "3701-31"
}

function ruleSourceUrl(id) {
  if (isORC(id)) return `https://codes.ohio.gov/ohio-revised-code/section-${id}`;
  return `https://codes.ohio.gov/ohio-administrative-code/rule-${id}`;
}

/**
 * Extract a short title from a paragraph's opening text.
 * Takes text up to the first period, comma, or semicolon (max 60 chars).
 */
function extractTitle(text) {
  if (!text) return '';
  const m = text.match(/^([^.,;]{1,60})[.,;]/);
  if (m) return m[1].trim();
  const s = text.trim();
  if (s.length <= 50) return s;
  const sp = s.lastIndexOf(' ', 50);
  return sp > 10 ? s.substring(0, sp) : s.substring(0, 50);
}

// ─── SECTION LABEL CLASSIFIER ────────────────────────────────────────────────
//
// Depth hierarchy:
//   0  (A)(B)(C)...         single uppercase
//   1  (1)(2)(3)...         digits
//   2  (a)(b)(c)...(aa)(bb) lowercase letters / double letters
//   3  (i)(ii)(iii)...      roman numerals
//   4  (A)(B)...            uppercase again, inside roman section
//
// Key ambiguity: single-char lowercase that is ALSO a valid roman numeral
// (i, v, x, l, c, d, m). Resolution: if current stack top is depth ≥ 2,
// treat as roman (depth 3); otherwise treat as letter (depth 2).

const LABEL_RE = /^\(([A-Za-z]+|\d+)\)\s*/;

// Multi-char patterns that are unambiguously roman numerals
const ROMAN_MULTI_RE = /^(ii+|iv|vi{0,3}|viii|ix|xi{0,3}|xii|xiii|xiv|xv|xvi{0,3}|xvii|xviii|xix|xx+|xxx*|xl|l[ixv]*|xc|c[ivxl]*|cd|d[clxvi]*)$/i;

// Single chars that are also valid roman numerals
const ROMAN_SINGLE = new Set(['i', 'v', 'x', 'l', 'c', 'd', 'm']);

// Double-letter pattern (aa, bb, cc...) — always depth 2
const DOUBLE_LETTER_RE = /^([a-z])\1+$/;

/**
 * Determine the hierarchical depth of a label given the current stack.
 * @param {string} raw  - raw label content without parens (e.g. "A", "1", "ii")
 * @param {number} stackTopLevel - level of the top stack item (-1 if empty)
 */
function classifyLabel(raw, stackTopLevel) {
  // Digits → always depth 1
  if (/^\d+$/.test(raw)) return 1;

  // Single uppercase → depth 0 or depth 4
  if (/^[A-Z]$/.test(raw)) {
    // Depth-4 detection heuristic:
    //   - If we're already inside a depth-4 sequence (stackTopLevel >= 4), continue at depth 4.
    //   - If inside a roman section (stackTopLevel == 3) and the letter is 'A', start a new
    //     depth-4 sub-sequence. ('A' cannot repeat at depth 0, so it must be depth 4 here.)
    //   - Any other capital after roman numerals is a new depth-0 major section.
    if (stackTopLevel >= 4) return 4;
    if (stackTopLevel === 3 && raw === 'A') return 4;
    return 0;
  }

  // Multi-char unambiguous roman → depth 3  (must check BEFORE double-letter, because
  // "ii" and "iii" would otherwise match the repeated-letter pattern)
  if (raw.length > 1 && ROMAN_MULTI_RE.test(raw)) return 3;

  // Repeated letters (aa, bb, ...) → letter, depth 2
  if (DOUBLE_LETTER_RE.test(raw)) return 2;

  // Single lowercase char
  if (raw.length === 1) {
    // Roman-ambiguous single chars (i, v, x, l, c, d, m): use stack context.
    // If parent is depth >= 2 (letter section), this is a roman numeral child (depth 3).
    if (ROMAN_SINGLE.has(raw) && stackTopLevel >= 2) return 3;
    return 2;
  }

  // Multi-char lowercase (not roman, not double) → depth 2
  return 2;
}

// ─── SECTION PARSER ──────────────────────────────────────────────────────────

/**
 * Parse labeled section lines into a nested tree.
 * @param {string[]} lines - lines starting at the first labeled section
 * @returns {object[]} root-level section nodes
 */
function parseSections(lines) {
  // Phase 1: tokenize into {raw, text} — join continuation lines
  const tokens = [];
  let current = null;

  for (const line of lines) {
    const m = LABEL_RE.exec(line);
    if (m) {
      if (current) tokens.push(current);
      current = { raw: m[1], text: line.slice(m[0].length).trim() };
    } else if (current) {
      current.text += (current.text ? ' ' : '') + line;
    }
    // lines before first label are ignored (preamble already handled)
  }
  if (current) tokens.push(current);

  // Phase 2: build tree via stack
  const roots = [];
  // stack items: { level: number, id: string, node: object }
  const stack = [];

  for (const tok of tokens) {
    const stackTopLevel = stack.length > 0 ? stack[stack.length - 1].level : -1;
    const depth = classifyLabel(tok.raw, stackTopLevel);

    // Pop stack items at same or deeper level
    while (stack.length > 0 && stack[stack.length - 1].level >= depth) {
      stack.pop();
    }

    const parentId = stack.length > 0 ? stack[stack.length - 1].id : '';
    const id = parentId ? `${parentId}-${tok.raw}` : tok.raw;
    const text = tok.text.trim();

    const node = {
      id,
      label: `(${tok.raw})`,
      title: extractTitle(text),
      text,
      children: []
    };

    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(node);
    } else {
      roots.push(node);
    }

    stack.push({ level: depth, id, node });
  }

  return roots;
}

function countSections(sections) {
  let n = sections.length;
  for (const s of sections) n += countSections(s.children);
  return n;
}

// ─── METADATA + FULL TEXT PARSER ─────────────────────────────────────────────

// Keys that may be run together on one line in a copy-paste
const META_SPLIT_RE = /(?=Five.?Year|Promulgated\s+Under|Authorized\s+By|Amplifies:|Prior\s+Effective)/gi;

// Lines to suppress from preamble (web chrome / navigation clutter)
const NOISE_RE = /^(ohio (administrative|revised) code|search|print|pdf|share|bookmark|home|back\s+to|skip\s+to|next|previous|download|lawriter|https?:\/\/|\d{4}\s*[\/|]|latest legislation|available versions|title \d+|legislative service|updates may be|house bill|senate bill|\[\s*view|section \d.*ohio)/i;

/**
 * Parse raw copy-pasted rule text into metadata + sections.
 */
function parseRuleText(ruleId, rawText) {
  // Normalize and expand concatenated metadata lines
  const rawLines = rawText.split('\n')
    .flatMap(l => l.split(META_SPLIT_RE))
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const meta = {
    title: '',
    chapterTitle: '',
    effectiveDate: '',
    fiveYearReview: '',
    promulgatedUnder: '',
    authorizedBy: '',
    amplifies: '',
    priorEffectiveDates: '',
    preamble: ''
  };

  // OAC: "3701-31-03 Some Title."   ORC: "Section 3749.02 | Some Title."
  const titleRe = new RegExp(`^${escapeRe(ruleId)}\\s+(.+?)\\s*\\.?$`, 'i');
  const orcTitleRe = new RegExp(`^Section\\s+${escapeRe(ruleId)}\\s*[|]\\s*(.+?)\\s*\\.?$`, 'i');
  const preambleLines = [];
  let sectionStartIdx = -1;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Rule title: OAC "3701-31-03 Some Title." or ORC "Section 3749.02 | Some Title."
    if (!meta.title) {
      const m = line.match(titleRe) || line.match(orcTitleRe);
      if (m) { meta.title = m[1].replace(/\.$/, '').trim(); continue; }
    }

    // Chapter title: "Chapter 3701-31 | Title" or "Chapter 3749 Swimming Pools"
    if (!meta.chapterTitle) {
      const m = line.match(/^Chapter\s+[\d.-]+\s*(?:[|:]\s*|\s+)(.+)$/i);
      if (m) { meta.chapterTitle = m[1].trim(); continue; }
    }

    // Effective date — same line: "Effective: July 25, 2024"
    //                — next line: "Effective:\n" then "September 10, 2012"
    if (!meta.effectiveDate) {
      const m = line.match(/^Effective\s*:\s*(.+)$/i) || line.match(/^Effective\s+(\d.+)$/i);
      if (m) { meta.effectiveDate = parseDate(m[1]); continue; }
      if (/^Effective\s*:?\s*$/i.test(line) && i + 1 < rawLines.length) {
        const candidate = parseDate(rawLines[i + 1]);
        if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
          meta.effectiveDate = candidate;
          i++;
          continue;
        }
      }
    }

    // Latest Legislation (ORC) — skip label + value line
    if (/^Latest\s+Legislation\s*:?\s*$/i.test(line)) { i++; continue; }

    // Five Year Review date
    {
      const m = line.match(/^Five.?Year.?Review[^:]*:\s*(.+)$/i);
      if (m) { meta.fiveYearReview = parseDate(m[1]); continue; }
    }

    // Promulgated Under
    {
      const m = line.match(/^Promulgated\s+Under\s*:\s*(.+)$/i);
      if (m) { meta.promulgatedUnder = m[1].trim(); continue; }
    }

    // Authorized By
    {
      const m = line.match(/^Authorized\s+By\s*:\s*(.+)$/i);
      if (m) { meta.authorizedBy = m[1].trim(); continue; }
    }

    // Amplifies
    {
      const m = line.match(/^Amplifies\s*:\s*(.+)$/i);
      if (m) { meta.amplifies = m[1].trim(); continue; }
    }

    // Prior Effective Dates
    {
      const m = line.match(/^Prior\s+Effective\s+Dates?\s*:\s*(.+)$/i);
      if (m) { meta.priorEffectiveDates = m[1].trim(); continue; }
    }

    // First labeled section → stop metadata pass
    if (LABEL_RE.test(line)) {
      sectionStartIdx = i;
      break;
    }

    // Candidate preamble line
    if (!NOISE_RE.test(line) && line.length >= 20) {
      preambleLines.push(line);
    }
  }

  // Preamble: join non-noise pre-section lines
  meta.preamble = preambleLines.join(' ').trim();

  // If title still empty, use first preamble word cluster as fallback title
  if (!meta.title && preambleLines.length > 0) {
    meta.title = extractTitle(preambleLines[0]);
  }

  const sectionLines = sectionStartIdx >= 0 ? rawLines.slice(sectionStartIdx) : [];
  const sections = parseSections(sectionLines);

  return { meta, sections, sectionCount: countSections(sections) };
}

// ─── JS OUTPUT GENERATION ────────────────────────────────────────────────────

function jsStr(v) {
  return JSON.stringify(v);
}

function sectionToJs(node, indent) {
  const pad = ' '.repeat(indent);
  let childrenStr;
  if (node.children.length === 0) {
    childrenStr = '[]';
  } else {
    const inner = node.children.map(c => sectionToJs(c, indent + 2)).join(',\n');
    childrenStr = `[\n${inner}\n${pad}]`;
  }
  return (
    `${pad}{\n` +
    `${pad}  id: ${jsStr(node.id)},\n` +
    `${pad}  label: ${jsStr(node.label)},\n` +
    `${pad}  title: ${jsStr(node.title)},\n` +
    `${pad}  text: ${jsStr(node.text)},\n` +
    `${pad}  children: ${childrenStr}\n` +
    `${pad}}`
  );
}

function generateRuleJs(ruleId, meta, sections) {
  const varName = ruleVarName(ruleId);
  const chapter = ruleChapter(ruleId);
  const sourceUrl = ruleSourceUrl(ruleId);
  const orc = isORC(ruleId);

  const sectionsJs = sections.length === 0
    ? '[]'
    : `[\n${sections.map(s => sectionToJs(s, 4)).join(',\n')}\n  ]`;

  const header = orc
    ? `// Ohio Revised Code Section ${ruleId}\n`
    : `// Ohio Administrative Code Rule ${ruleId}\n`;

  const oacFields = orc ? '' : (
    `  fiveYearReview: ${jsStr(meta.fiveYearReview)},\n` +
    `  promulgatedUnder: ${jsStr(meta.promulgatedUnder)},\n` +
    `  authorizedBy: ${jsStr(meta.authorizedBy)},\n` +
    `  amplifies: ${jsStr(meta.amplifies)},\n` +
    `  priorEffectiveDates: ${jsStr(meta.priorEffectiveDates)},\n`
  );

  return (
    `${header}` +
    `// ${meta.title || '(title not detected)'}\n` +
    `// Effective: ${meta.effectiveDate || '(unknown)'}\n` +
    `// Source: ${sourceUrl}\n` +
    `\n` +
    `const ${varName} = {\n` +
    `  id: ${jsStr(ruleId)},\n` +
    `  type: ${jsStr(orc ? 'statute' : 'rule')},\n` +
    `  title: ${jsStr(meta.title)},\n` +
    `  chapter: ${jsStr(chapter)},\n` +
    `  chapterTitle: ${jsStr(meta.chapterTitle)},\n` +
    `  effectiveDate: ${jsStr(meta.effectiveDate)},\n` +
    `  sourceUrl: ${jsStr(sourceUrl)},\n` +
    `${oacFields}` +
    `  preamble: ${jsStr(meta.preamble)},\n` +
    `  sections: ${sectionsJs}\n` +
    `};\n`
  );
}

// ─── INDEX.HTML UPDATER ──────────────────────────────────────────────────────

function updateHtml(htmlPath, ruleId) {
  if (!fs.existsSync(htmlPath)) return;

  let content = fs.readFileSync(htmlPath, 'utf8');
  const scriptTag = `  <script src="js/rules/${ruleId}.js"></script>`;

  // Already present → nothing to do
  if (content.includes(`js/rules/${ruleId}.js`)) return;

  // Insert before the app.js script tag
  const appScriptTag = '  <script src="js/app.js"></script>';
  if (!content.includes(appScriptTag)) {
    throw new Error('Cannot find app.js script tag in index.html');
  }

  content = content.replace(appScriptTag, `${scriptTag}\n${appScriptTag}`);
  fs.writeFileSync(htmlPath, content, 'utf8');
}

// ─── INDEX.JS UPDATER ────────────────────────────────────────────────────────

function updateIndex(indexPath, ruleId, meta) {
  const varName = ruleVarName(ruleId);
  const type = isORC(ruleId) ? 'statute' : 'rule';
  const newEntry =
    `  {\n` +
    `    id: ${jsStr(ruleId)},\n` +
    `    type: ${jsStr(type)},\n` +
    `    title: ${jsStr(meta.title)},\n` +
    `    getData: () => ${varName}\n` +
    `  }`;

  // Create index from scratch if it doesn't exist
  if (!fs.existsSync(indexPath)) {
    const content =
      `// Rule Registry — add new rules here\n` +
      `const RULE_REGISTRY = [\n` +
      `${newEntry}\n` +
      `];\n`;
    fs.writeFileSync(indexPath, content, 'utf8');
    return;
  }

  let content = fs.readFileSync(indexPath, 'utf8');

  // Remove any comment lines that mention this rule ID (e.g. "// Future: ...")
  const idPat = escapeRe(ruleId);
  content = content.replace(new RegExp(`[ \\t]*\\/\\/[^\\n]*${idPat}[^\\n]*\\n`, 'g'), '');

  // Already in registry as a real entry → skip
  if (content.includes(`"${ruleId}"`)) {
    return;
  }

  // Find closing ]; of RULE_REGISTRY
  const registryEnd = content.lastIndexOf('];');
  if (registryEnd === -1) {
    throw new Error('Cannot find RULE_REGISTRY closing ]; in index.js');
  }

  // Find the last } before ];
  const lastBrace = content.lastIndexOf('}', registryEnd);

  let newContent;
  if (lastBrace === -1) {
    // Empty array — replace [] with [entry]
    newContent = content.replace(/\[\s*\]/, `[\n${newEntry}\n]`);
  } else {
    // Append after last entry: add trailing comma + new entry
    const before = content.substring(0, lastBrace + 1);
    const after = content.substring(registryEnd); // starts with '];'
    // Clean up any blank lines between last } and ];
    newContent = `${before},\n${newEntry}\n${after}`;
  }

  fs.writeFileSync(indexPath, newContent, 'utf8');
}

// ─── FETCH + HTML→TEXT ───────────────────────────────────────────────────────

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ODH-Rule-Scraper/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function htmlToText(html) {
  // Remove entire script/style/nav/header/footer blocks
  html = html.replace(/<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Block-level elements → newlines so lines stay separate
  html = html.replace(/<\/?(p|div|li|br|h[1-6]|section|article|tr|td|th)[^>]*>/gi, '\n');

  // Strip remaining tags
  html = html.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  html = html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  // Collapse whitespace within lines, drop blank lines
  return html
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0)
    .join('\n');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const pasteMode = args.includes('--paste');
  const debugMode = args.includes('--debug');

  console.log('\nODH Rule Scraper');
  console.log('─'.repeat(36));

  // Step 1: get rule ID — from CLI arg or prompt
  let ruleId = args.find(a => !a.startsWith('--'));

  if (!ruleId) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    ruleId = await new Promise(resolve =>
      rl.question('Rule ID (e.g. 3701-31-03): ', answer => { rl.close(); resolve(answer.trim()); })
    );
  }

  const validOAC = /^\d{4}-\d{2,3}-\d{2,3}[a-z]?$/.test(ruleId);
  const validORC = /^\d+\.\d+[A-Za-z]?$/.test(ruleId);
  if (!ruleId || (!validOAC && !validORC)) {
    console.error(`\n✗ Invalid ID format: "${ruleId}"`);
    console.error('  OAC rule:    XXXX-XX-XX   (e.g. 3701-31-03)');
    console.error('  ORC section: XXXX.XX      (e.g. 3749.01)');
    process.exit(1);
  }

  // Step 2: get raw text — fetch automatically, or paste manually with --paste
  let rawText;

  if (pasteMode) {
    console.log('\nPaste the full rule text, then press Ctrl+D when done:\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const textLines = [];
    rl.on('line', line => textLines.push(line));
    await new Promise(resolve => rl.once('close', resolve));
    rawText = textLines.join('\n');
    if (!rawText.trim()) {
      console.error('\n✗ No text was pasted.');
      process.exit(1);
    }
  } else {
    const url = ruleSourceUrl(ruleId);
    process.stdout.write(`\nFetching ${url} ... `);
    const html = await fetchHtml(url);
    rawText = htmlToText(html);
    console.log('done');
    if (debugMode) {
      console.log('\n── Extracted text (first 60 lines) ──');
      rawText.split('\n').slice(0, 60).forEach((l, i) => console.log(`${String(i+1).padStart(3)}: ${l}`));
      console.log('─'.repeat(40));
    }
  }

  // Step 3: parse
  const { meta, sections, sectionCount } = parseRuleText(ruleId, rawText);
  console.log(`✓ Parsed — ${sectionCount} sections found`);

  // Step 4: determine output paths (relative to this script's directory)
  const scriptDir = path.dirname(path.resolve(process.argv[1]));
  const rulesDir = path.join(scriptDir, 'js', 'rules');

  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }

  const ruleFile = path.join(rulesDir, `${ruleId}.js`);
  const indexFile = path.join(rulesDir, 'index.js');

  // Step 5: write rule file — abort only if truly nothing was captured.
  // Note: ORC sections are often plain prose with no labeled paragraphs, so
  // sectionCount === 0 is valid for statutes. Only abort when there is no
  // title AND no preamble text either.
  const hasContent = meta.title || sectionCount > 0 || meta.preamble.length > 30;
  if (!hasContent && !pasteMode) {
    console.error(`\n✗ No content found for ${ruleId} — it may not exist or the page structure changed.`);
    console.error(`  Try: node scrape-rule.js ${ruleId} --paste`);
    console.error('  No file was written.');
    process.exit(1);
  }

  const ruleJs = generateRuleJs(ruleId, meta, sections);
  fs.writeFileSync(ruleFile, ruleJs, 'utf8');
  console.log(`✓ Written: js/rules/${ruleId}.js`);

  // Step 6: update index and html
  updateIndex(indexFile, ruleId, meta);
  console.log(`✓ Updated: js/rules/index.js`);

  const htmlFile = path.join(scriptDir, 'index.html');
  updateHtml(htmlFile, ruleId);
  console.log(`✓ Updated: index.html`);

  // Step 7: summary hints
  if (!meta.title) {
    console.log('\n  Note: rule title not detected — edit the "title" field in the output file.');
  }
  if (sectionCount === 0 && !isORC(ruleId)) {
    console.log('\n  Warning: no labeled sections found. Check the output file.');
  }
}

main().catch(err => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
