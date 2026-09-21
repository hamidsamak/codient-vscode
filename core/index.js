'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDir, readFile } = require('./fileOps');
const { buildPrompt, collectFiles } = require('./prompt');
const { showHistory, rollbackFile } = require('./backup');
const {
  createContext, getPage, navigateAndCheckChat,
  sendPrompt, sendFollowUp, waitForGenerationDone,
} = require('./browser');
const { processResponse } = require('./responseProcessor');
const { MODEL_CONFIG, resolveTargetUrl } = require('./modelConfig');

const HOME_DIR = os.homedir();
const BASE_DIR = path.join(HOME_DIR, '.codient');

function dirs() {
  const backupDir = path.join(BASE_DIR, 'backups');
  const reportDir = path.join(BASE_DIR, 'reports');
  const profilesBaseDir = path.join(BASE_DIR, 'profiles');
  const debugDir = path.join(BASE_DIR, 'debug');
  [BASE_DIR, backupDir, reportDir, profilesBaseDir, debugDir].forEach(ensureDir);
  return { backupDir, reportDir, profilesBaseDir, debugDir };
}

function listProfiles(onLog = console.log) {
  const { profilesBaseDir } = dirs();
  if (!fs.existsSync(profilesBaseDir)) {
    onLog('\n❌ No profiles directory found. No profiles created yet.');
    return [];
  }
  const profiles = fs.readdirSync(profilesBaseDir)
    .filter((d) => fs.statSync(path.join(profilesBaseDir, d)).isDirectory())
    .sort();

  if (profiles.length === 0) {
    onLog('\n❌ No profiles found.');
    return [];
  }

  onLog(`\n👤 Available Chrome profiles (${profilesBaseDir}):`);
  onLog('='.repeat(50));
  profiles.forEach((p) => onLog(`  • ${p}`));
  onLog('='.repeat(50));
  return profiles;
}

async function defaultOpenReport(reportPath) {
  try {
    const open = require('open');
    await open(`file://${reportPath}`);
  } catch {
  }
}

async function runTask(options) {
  const {
    question,
    files = [],
    contextFiles = [],
    overwrite = false,
    debug = false,
    proxy = null,
    model = 'deepseek',
    profile = 'default',
    chatId = null,
    fullContext = false,
    nonInteractive = false,
    cwd = process.cwd(),
    maxRounds = 5,
    onLog = () => {},
    openReport = defaultOpenReport,
    resolveMissingFile = null,
  } = options;

  const { backupDir, reportDir, profilesBaseDir, debugDir } = dirs();
  const profileDir = path.join(profilesBaseDir, profile);

  const validFiles = collectFiles(files, cwd, onLog);

  onLog(`\n📝 Your question: ${question}`);
  onLog(`👤 Profile: ${profile}`);
  if (chatId) onLog(`💬 Requested chat: ${chatId}`);
  onLog(validFiles.length ? `📁 Number of files: ${validFiles.length}` : '📁 No input files — AI will create new file(s) from scratch');
  if (debug) onLog('🐛 Debug mode is ENABLED - Saving prompt, input, and response HTML');

  const context = await createContext(profileDir, proxy, { onLog });
  const page = await getPage(context);

  const hadChatId = Boolean(chatId);
  let chatResult = { newChatUrl: null, invalidReason: null };

  try {
    const nav = await navigateAndCheckChat(page, model, chatId, onLog);
    const isContinuingChat = nav.valid && !fullContext;
    const includeRules = !isContinuingChat;
    const includeContext = !isContinuingChat;
    chatResult.invalidReason = nav.invalidReason;

    if (chatId) {
      if (nav.valid) {
        onLog(isContinuingChat
          ? '📦 Skipping Rules + project structure/cwd (already known to this chat)'
          : '📦 --full-context set: resending Rules + project structure/cwd');
      } else {
        onLog('📦 Falling back to a new chat with full Rules + project structure/cwd');
      }
    }

    const fullQuestion = buildPrompt(question, contextFiles, validFiles, cwd, { includeRules, includeContext });

    const sendResult = await sendPrompt(page, model, fullQuestion, {
      debug, debugDir, chatId: nav.valid ? nav.chatId : null, onLog,
    });
    if (!sendResult.success) {
      return { success: false, chat: { hadChatId, newChatUrl: null, model, invalidReason: chatResult.invalidReason } };
    }
    chatResult.newChatUrl = sendResult.newChatUrl;

    let finalDiffs = [];
    let finalWritten = [];
    let finalReportPath = null;
    let finalExplanationHtml = '';

    for (let round = 0; round < maxRounds; round++) {
      const result = await processResponse(page, model, {
        overwrite, backupDir, reportDir, currentDir: cwd, onLog, openReport,
      });

      if (result === null) break;

      if (!result.needMoreInfo) {
        finalDiffs = result.diffs || [];
        finalWritten = result.writtenFiles || [];
        finalReportPath = result.reportPath || null;
        finalExplanationHtml = result.explanationHtml || '';
        break;
      }

      const { reason, files: requestedFiles } = result;
      onLog(`\n🔍 AI needs more information (round ${round + 1}):`);
      onLog(`   Reason: ${reason}`);
      onLog(`   Requested files: ${requestedFiles.join(', ')}`);

      const extraFilesContent = [];
      const missingFiles = [];
      for (const reqFile of requestedFiles) {
        const filePath = path.join(cwd, reqFile);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          try {
            extraFilesContent.push([reqFile, filePath, readFile(filePath)]);
            onLog(`   ✅ Found: ${reqFile}`);
          } catch (e) {
            onLog(`   ❌ Could not read ${reqFile}: ${e.message}`);
          }
        } else {
          onLog(`   ⚠️  File not found: ${reqFile} — AI will create it`);
          missingFiles.push(reqFile);
          if (!nonInteractive && resolveMissingFile) {
            const userPath = await resolveMissingFile(reqFile);
            if (userPath && fs.existsSync(userPath) && fs.statSync(userPath).isFile()) {
              try {
                extraFilesContent.push([reqFile, userPath, readFile(userPath)]);
                missingFiles.pop();
                onLog(`   ✅ Loaded: ${userPath}`);
              } catch (e) {
                onLog(`   ❌ Could not read ${userPath}: ${e.message}`);
              }
            }
          }
        }
      }

      const followUpOk = await sendFollowUp(page, model, extraFilesContent, { debug, debugDir, missingFiles, onLog });
      if (!followUpOk) break;
    }

    onLog(`\n💾 Profile session saved in: ${profileDir}`);

    return {
      success: true,
      diffs: finalDiffs,
      writtenFiles: finalWritten,
      reportPath: finalReportPath,
      explanationHtml: finalExplanationHtml,
      chat: { hadChatId, newChatUrl: chatResult.newChatUrl, model, invalidReason: chatResult.invalidReason },
    };
  } catch (e) {
    onLog(`❌ Error: ${e.message}`);
    return { success: false, error: e.message, chat: { hadChatId, newChatUrl: chatResult.newChatUrl, model, invalidReason: chatResult.invalidReason } };
  } finally {
    await context.close();
    onLog('✅ Browser closed - Profile information saved');
  }
}

async function openBrowserSession({ model = 'deepseek', profile = 'default', proxy = null, chatId = null, onLog = () => {} } = {}) {
  const { profilesBaseDir } = dirs();
  const profileDir = path.join(profilesBaseDir, profile);

  onLog(`\n🌐 Starting browser in standalone mode (profile: ${profile})...`);
  onLog('📝 Please login and do whatever you need.');
  onLog('🔒 Session cookies will be saved.');
  onLog('❌ Close the browser window when you\'re done.\n');

  const context = await createContext(profileDir, proxy, { onLog });
  const page = await getPage(context);
  await page.goto(resolveTargetUrl(model, chatId), { waitUntil: 'domcontentloaded' });

  await new Promise((resolve) => {
    context.on('close', () => {
      onLog('\n✅ Browser closed. Session saved!');
      resolve();
    });
  });
}

module.exports = {
  MODEL_CONFIG,
  runTask,
  openBrowserSession,
  listProfiles,
  showHistory: (fileName, onLog) => showHistory(dirs().backupDir, fileName, onLog),
  rollbackFile: (fileName, cwd, timestamp, onLog) => rollbackFile(dirs().backupDir, fileName, cwd, timestamp, onLog),
};
