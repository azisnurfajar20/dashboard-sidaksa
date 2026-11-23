import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import config from '../../playwright.config.ts';

assert.equal(config.use?.channel, 'chrome', 'Local QA must use the verified system Chrome');
const base = path.resolve('.private/test-tmp');
await mkdir(base, { recursive: true });
const temporary = await mkdtemp(path.join(base, 'browser-config-'));
Object.assign(process.env, { TEMP: temporary, TMP: temporary, TMPDIR: temporary });
let browser;
try {
  browser = await chromium.launch({ channel: config.use.channel, headless: true });
  const page = await browser.newPage();
  await page.goto('data:text/html,<h1>SIDAKSA_BROWSER_CHECK</h1>');
  assert.equal(await page.locator('h1').textContent(), 'SIDAKSA_BROWSER_CHECK');
  console.log(JSON.stringify({ channel: config.use.channel, browserVersion: browser.version(), probe: 'passed' }));
} finally {
  if (browser) await browser.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
