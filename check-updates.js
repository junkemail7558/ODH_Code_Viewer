#!/usr/bin/env node
// ODH Rule Update Checker
// Usage: node check-updates.js
//
// Fetches each rule's source page on ohio.gov and compares the live effective
// date against what is stored in this viewer's rule data files.
// No npm packages required — uses only built-in Node modules.

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Rules to check ──────────────────────────────────────────────────────────
// Add a new entry here whenever you add a rule to js/rules/
const RULES = [
  {
    id: '3701-31-04',
    storedEffectiveDate: '2024-07-25',           // Keep in sync with js/rules/3701-31-04.js
    url: 'https://codes.ohio.gov/ohio-administrative-code/rule-3701-31-04'
  }
  // { id: '3701-31-03', storedEffectiveDate: 'YYYY-MM-DD', url: '...' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ODH-Rule-Checker/1.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Parse the effective date out of the ohio.gov page HTML.
// The page structure uses:
//   <div class="label">Effective:</div>
//   <div class="value">July 25, 2024</div>
function parseEffectiveDate(html) {
  // Primary: structured label/value pattern used by codes.ohio.gov
  const structured = html.match(
    /class="label">Effective:<\/div>\s*<div class="value">([^<]+)<\/div>/
  );
  if (structured) {
    const d = new Date(structured[1].trim());
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }

  // Fallback: any "Effective: Month DD, YYYY" text in case page structure changes
  const fallback = html.match(/Effective:\s*([A-Z][a-z]+ \d{1,2},\s*\d{4})/);
  if (fallback) {
    const d = new Date(fallback[1].trim());
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }

  return null;
}

function isoToDisplay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\nODH Code Viewer — Rule Update Check');
  console.log('─'.repeat(50));
  console.log(`Run date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n`);

  let allCurrent = true;

  for (const rule of RULES) {
    process.stdout.write(`Checking Rule ${rule.id}... `);

    let html;
    try {
      html = await fetch(rule.url);
    } catch (err) {
      console.log(`\n  ✖ Could not reach ${rule.url}`);
      console.log(`    ${err.message}`);
      allCurrent = false;
      continue;
    }

    const liveDate = parseEffectiveDate(html);

    if (!liveDate) {
      console.log('\n  ⚠ Could not parse effective date from the page.');
      console.log(`    The page format may have changed. Check manually: ${rule.url}`);
      allCurrent = false;
      continue;
    }

    if (liveDate === rule.storedEffectiveDate) {
      console.log(`✓`);
      console.log(`  Effective date matches: ${isoToDisplay(liveDate)}`);
    } else {
      console.log(`\n  ⚠ EFFECTIVE DATE CHANGED`);
      console.log(`    Stored : ${isoToDisplay(rule.storedEffectiveDate)}`);
      console.log(`    Live   : ${isoToDisplay(liveDate)}`);
      console.log(`    → The rule was amended. Review changes and update the viewer data.`);
      console.log(`    → Source: ${rule.url}`);
      allCurrent = false;
    }

    console.log();
  }

  console.log('─'.repeat(50));
  if (allCurrent) {
    console.log('✓ All rules are current. No action needed.\n');
  } else {
    console.log('⚠ One or more rules may need attention. See above.\n');
    process.exit(1); // Non-zero exit so this can be used in scripts/automation
  }
}

main().catch((err) => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
