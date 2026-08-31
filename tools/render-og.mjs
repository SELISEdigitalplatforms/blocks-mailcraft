// Renders tools/og-card.html to assets/brand/og.png at 1200x630 — the size
// X, LinkedIn, Slack and Facebook all crop from cleanly (1.91:1).
//
//   node tools/render-og.mjs
//
// Uses whichever Chrome or Edge is already installed; there is no dependency
// to add for a file that changes once a year.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = candidates.find(existsSync);
if (!browser) {
  console.error('No Chrome or Edge found. Install one, or add its path to `candidates`.');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'mailcraft-og-'));
const out = join(root, 'assets/brand/og.png');
try {
  execFileSync(browser, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--window-size=1200,630',
    '--screenshot=' + out,
    '--virtual-time-budget=6000',   // let the webfonts land before the shot
    '--user-data-dir=' + profile,
    pathToFileURL(join(root, 'tools/og-card.html')).href,
  ], { stdio: 'inherit' });
  console.log('wrote ' + out);
} finally {
  rmSync(profile, { recursive: true, force: true });
}
