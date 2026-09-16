'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');
const { MODEL_CONFIG, resolveTargetUrl } = require('./modelConfig');
const { ensureDir, writeFile } = require('./fileOps');

const CHAT_VALIDATION_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtmlLine(line) {
  return line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function detectSystemTheme() {
  try {
    if (process.platform === 'win32') {
      const out = require('child_process').execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme',
        { encoding: 'utf8' }
      );
      const match = out.match(/0x(\d+)/);
      if (match) return match[1] === '0' ? 'dark' : 'light';
    } else if (process.platform === 'darwin') {
      try {
        require('child_process').execSync('defaults read -g AppleInterfaceStyle', { encoding: 'utf8' });
        return 'dark';
      } catch {
        return 'light';
      }
    } else if (process.platform === 'linux') {
      const out = require('child_process').execSync(
        'gsettings get org.gnome.desktop.interface color-scheme',
        { encoding: 'utf8' }
      ).trim();
      if (out.includes('dark')) return 'dark';
      if (out.includes('light')) return 'light';
    }
  } catch {
  }
  return 'no-preference';
}

async function createContext(profileDir, proxy, { onLog = () => {} } = {}) {
  ensureDir(profileDir);
  onLog(`📁 Using profile: ${profileDir}`);
  onLog('🚀 Launching browser...');

  const args = ['--disable-blink-features=AutomationControlled'];

  if (proxy) {
    onLog(`🌐 Using proxy: ${proxy}`);
    args.push(`--proxy-server=${proxy}`);
  }

  const launchOptions = {
    headless: false,
    args,
    viewport: null,
    colorScheme: detectSystemTheme(),
    ignoreDefaultArgs: ['--enable-automation'],
    locale: process.env.CODIENT_LOCALE || undefined,
  };

  try {
    launchOptions.channel = 'chrome';
    const context = await chromium.launchPersistentContext(profileDir, launchOptions);
    onLog('🧭 Using system Chrome (channel: chrome)');
    return context;
  } catch (err) {
    onLog(`⚠️ Could not launch system Chrome (${err.message}); falling back to bundled Chromium if available`);
    delete launchOptions.channel;
    return chromium.launchPersistentContext(profileDir, launchOptions);
  }
}

async function getPage(context) {
  const pages = context.pages();
  return pages.length ? pages[0] : context.newPage();
}

async function navigateAndCheckChat(page, model, chatId, onLog = () => {}, maxWaitMs = CHAT_VALIDATION_TIMEOUT_MS, pollIntervalMs = 400) {
  const config = MODEL_CONFIG[model];
  const targetUrl = resolveTargetUrl(model, chatId);

  onLog(chatId ? `📄 Opening existing ${cap(model)} chat (${chatId})...` : `📄 Opening ${cap(model)}...`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  if (!chatId) {
    return { chatId: null, valid: false, invalidReason: null };
  }

  const phrases = config.not_found_phrases || [];
  const baseUrl = config.url.replace(/\/$/, '');
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const responseEls = await page.$$(config.response_selector);
    if (responseEls.length > 0) {
      onLog('✅ Existing chat history detected — continuing this chat');
      return { chatId, valid: true, invalidReason: null };
    }

    const current = page.url().replace(/\/$/, '');
    if (!current.includes(chatId) && (current === baseUrl || current === `${baseUrl}/new`)) {
      onLog(`⚠️ Chat ID '${chatId}' looks invalid — site redirected automatically`);
      return { chatId: null, valid: false, invalidReason: 'the saved chat page no longer exists' };
    }

    if (phrases.length) {
      try {
        const bodyText = (await page.locator('body').innerText()).toLowerCase();
        if (phrases.some((p) => bodyText.includes(p))) {
          onLog(`⚠️ Chat ID '${chatId}' looks invalid or expired (not-found page detected)`);
          await page.goto(config.url, { waitUntil: 'domcontentloaded' });
          return { chatId: null, valid: false, invalidReason: 'the saved chat page no longer exists' };
        }
      } catch {
      }
    }

    await sleep(pollIntervalMs);
  }

  onLog(`⚠️ Chat ID '${chatId}' looks invalid or expired (timeout) — starting a new chat instead`);
  await page.goto(config.url, { waitUntil: 'domcontentloaded' });
  return { chatId: null, valid: false, invalidReason: "Codient couldn't confirm the saved chat in time" };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function isGenerationDone(page, config) {
  const existsSelector = config.done_selector_exists;
  const notExistsSelector = config.done_selector_not_exists;

  if (!existsSelector && !notExistsSelector) return false;

  if (existsSelector) {
    const els = await page.$$(existsSelector);
    if (els.length === 0) return false;
  }

  if (notExistsSelector) {
    const els = await page.$$(notExistsSelector);
    if (els.length > 0) return false;
  }

  return true;
}

async function waitForGenerationDone(page, config, pollIntervalMs = 1000) {
  while (true) {
    if (await isGenerationDone(page, config)) break;
    await sleep(pollIntervalMs);
  }
}

async function getLastResponseFingerprint(page, selector) {
  const els = await page.$$(selector);
  if (els.length === 0) return [0, null];
  const text = await els[els.length - 1].innerText();
  const hash = crypto.createHash('md5').update(text, 'utf8').digest('hex');
  return [els.length, hash];
}

async function waitForNewResponse(page, selector, oldFingerprint, timeoutMs = 600000, pollIntervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fp = await getLastResponseFingerprint(page, selector);
    if (fp[0] !== oldFingerprint[0] || fp[1] !== oldFingerprint[1]) return;
    await sleep(pollIntervalMs);
  }
  throw new Error('Timed out waiting for a new response');
}

async function sendPrompt(page, model, fullQuestion, { debug = false, debugDir = null, chatId = null, onLog = () => {} } = {}) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

  if (debug) {
    writeFile(path.join(debugDir, `prompt_${timestamp}.txt`), fullQuestion);
    onLog(`🐛 Debug: Prompt saved to ${path.join(debugDir, `prompt_${timestamp}.txt`)}`);
  }

  const config = MODEL_CONFIG[model];

  let payload = fullQuestion;
  if (model === 'claude' || model === 'chatgpt') {
    payload = fullQuestion
      .split(/\r\n|\r|\n/)
      .map((line) => `<p>${escapeHtmlLine(line)}</p>`)
      .join('\n');
  }

  await page.waitForSelector(config.input_selector, { timeout: 600000, state: 'visible' });
  const inputHandle = await page.$(config.input_selector);
  onLog('✅ Page is ready!');

  await inputHandle.type(' ');
  await sleep(1000);
  await inputHandle.evaluate(config.fill, payload);
  await sleep(1000);
  await inputHandle.type(' ');
  onLog('✅ Question and file content sent');

  const oldFingerprint = await getLastResponseFingerprint(page, config.response_selector);

  const sendButtons = await page.$$(config.send_selector);
  if (sendButtons.length === 0) {
    onLog('❌ Send button not found!');
    return { success: false };
  }
  await sendButtons[config.send_index].click();
  onLog('📨 Message sent, waiting for response...');

  await waitForNewResponse(page, config.response_selector, oldFingerprint);
  await sleep(1000);
  await waitForGenerationDone(page, config);

  let newChatUrl = null;
  if (!chatId) {
    newChatUrl = page.url();
    onLog(`🔗 New chat started: ${newChatUrl}`);
  }

  if (debug) {
    const pageHtml = await page.content();
    writeFile(path.join(debugDir, `page_${timestamp}.html`), pageHtml);
    onLog(`🐛 Debug: HTML page saved to ${path.join(debugDir, `page_${timestamp}.html`)}`);
  }

  return { success: true, newChatUrl };
}

async function sendFollowUp(page, model, extraFilesContent, { debug = false, debugDir = null, missingFiles = [], onLog = () => {} } = {}) {
  const config = MODEL_CONFIG[model];
  const { numberLines } = require('./fileOps');

  let followUp = 'Here are the additional files you requested:\n';
  for (const [fileName, filePath, content] of extraFilesContent) {
    const numbered = numberLines(content);
    followUp += `\n<file name="${fileName}" path="${filePath}">\n<![CDATA[\n${numbered}\n]]>\n</file>\n`;
  }

  if (missingFiles.length) {
    followUp += '\nThe following files do not exist yet and must be created by you from scratch:\n';
    for (const f of missingFiles) followUp += `- ${f}\n`;
  }

  followUp += '\nNow please provide the complete response following the original rules.';

  if (debug) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    writeFile(path.join(debugDir, `followup_${timestamp}.txt`), followUp);
    onLog(`🐛 Debug: Follow-up prompt saved`);
  }

  let payload = followUp;
  if (model === 'claude' || model === 'chatgpt') {
    payload = followUp
      .split(/\r\n|\r|\n/)
      .map((line) => `<p>${escapeHtmlLine(line)}</p>`)
      .join('\n');
  }

  await page.waitForSelector(config.input_selector, { timeout: 60000, state: 'visible' });
  const inputHandle = await page.$(config.input_selector);

  await inputHandle.type(' ');
  await sleep(1000);
  await inputHandle.evaluate(config.fill, payload);
  await sleep(1000);
  await inputHandle.type(' ');

  const sendButtons = await page.$$(config.send_selector);
  if (sendButtons.length === 0) {
    onLog('❌ Send button not found for follow-up!');
    return false;
  }
  await sendButtons[config.send_index].click();
  onLog('📨 Follow-up sent, waiting for response...');

  await sleep(2000);
  await waitForGenerationDone(page, config);
  return true;
}

module.exports = {
  createContext,
  getPage,
  navigateAndCheckChat,
  isGenerationDone,
  waitForGenerationDone,
  getLastResponseFingerprint,
  waitForNewResponse,
  sendPrompt,
  sendFollowUp,
};