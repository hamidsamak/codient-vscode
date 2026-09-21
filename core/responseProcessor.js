'use strict';

const fs = require('fs');
const path = require('path');
const { readFile, writeFile, ensureDir, parseHunks, applyHunks } = require('./fileOps');
const { formatTimestamp, unifiedDiffLines, generateDiffHtml } = require('./backup');
const { MODEL_CONFIG } = require('./modelConfig');

const NEED_MORE_INFO_RE = /<need_more_info\s+reason="([^"]+)"\s+files="([^"]+)"\s*\/?>/;
const FILE_TAG_RE = /<file\s+name="(?<name>[^"]+)"\s+path="(?<path>[^"]+)"(?:\s+action="(?<action>[^"]+)")?[^>]*>\s*(?:<!\[CDATA\[)?(?<content>.*?)(?:\]\]>)?\s*<\/file>/gs;

async function extractExplanationHtml(responseEl) {
  try {
    return await responseEl.evaluate((root) => {
      const FILE_MARK = new RegExp('<' + 'file\\s|<' + 'need_more_info\\s');
      const PROSE = 'p, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, table';
      const clone = root.cloneNode(true);
      clone.querySelectorAll('pre').forEach((pre) => {
        if (!FILE_MARK.test(pre.textContent || '')) return;
        let target = pre;
        while (
          target.parentElement &&
          target.parentElement !== clone &&
          target.parentElement.querySelectorAll('pre').length === 1 &&
          !target.parentElement.querySelector(PROSE)
        ) {
          target = target.parentElement;
        }
        target.remove();

      });
      return clone.innerHTML;
    });
  } catch {
    return '';
  }
}

async function processResponse(page, model, options) {
  const {
    overwrite,
    backupDir,
    reportDir,
    currentDir,
    onLog = () => {},
    openReport = null,
  } = options;

  const config = MODEL_CONFIG[model];
  const responseEls = await page.$$(config.response_selector);

  if (responseEls.length === 0) {
    onLog('❌ No response received');
    return null;
  }

  try {
    const last = responseEls[responseEls.length - 1];
    const fullText = await last.innerText();

    const needMoreMatch = fullText.match(NEED_MORE_INFO_RE);
    if (needMoreMatch) {
      const reason = needMoreMatch[1];
      const requestedFiles = needMoreMatch[2].split(',').map((f) => f.trim());
      return { needMoreInfo: true, reason, files: requestedFiles };
    }

    const explanationHtml = await extractExplanationHtml(last);

    const codeBlocks = await last.$$('pre');
    if (codeBlocks.length === 0) {
      onLog('⚠️ No code blocks found in response');
      const outputFile = path.join(currentDir, `full_response_${Date.now()}.txt`);
      writeFile(outputFile, `Full response:\n${fullText}\n`);
      onLog(`💾 Full response saved to ${outputFile}`);
      return { needMoreInfo: false, diffs: [], writtenFiles: [], reportPath: null, explanationHtml };
    }

    let xmlContent = null;
    for (const block of codeBlocks) {
      const text = await block.innerText();
      if (/<file\s/.test(text)) {
        xmlContent = text;
        break;
      }
    }
    if (xmlContent === null) xmlContent = await codeBlocks[0].innerText();


    const matches = [...xmlContent.matchAll(FILE_TAG_RE)];
    if (matches.length === 0) {
      onLog('⚠️ No <file> tags found in XML response');
      return { needMoreInfo: false, diffs: [], writtenFiles: [], reportPath: null, explanationHtml };
    }

    onLog(`✅ ${matches.length} file(s) found in response`);

    const diffs = [];
    const writtenFiles = [];

    for (const match of matches) {
      const fileName = match.groups.name;
      let filePath = match.groups.path;
      const action = (match.groups.action || 'edit').toLowerCase();
      const rawContent = (match.groups.content || '').trim();

      if (!path.isAbsolute(filePath)) filePath = path.join(currentDir, filePath);

      const isNewFile = action === 'create';
      onLog(isNewFile ? `🆕 New file to create: ${fileName}` : `✏️  Editing existing file: ${fileName}`);

      let oldContent = '';
      if (fs.existsSync(filePath)) {
        oldContent = readFile(filePath);

        const ts = formatTimestamp();
        const relPath = path.relative(currentDir, filePath);
        const relDir = path.dirname(relPath);
        const ext = path.extname(filePath);
        const name = path.basename(filePath, ext);

        let backupPath;
        if (relDir && relDir !== '.') {
          const backupSubdir = path.join(backupDir, relDir);
          ensureDir(backupSubdir);
          backupPath = path.join(backupSubdir, `${name}_${ts}${ext}`);
        } else {
          backupPath = path.join(backupDir, `${name}_${ts}${ext}`);
        }

        ensureDir(path.dirname(backupPath));
        writeFile(backupPath, oldContent);
        onLog(`🗂 Backup: ${backupPath}`);
      }

      let codeContent;
      if (isNewFile) {
        codeContent = rawContent;
      } else {
        const hunks = parseHunks(rawContent);
        if (hunks.length === 0) {
          onLog(`⚠️ No <hunk> tags found for '${fileName}' — skipping (nothing applied)`);
          continue;
        }
        codeContent = applyHunks(oldContent, hunks);
        onLog(`🧩 Applied ${hunks.length} hunk(s) to '${fileName}'`);
      }

      const diffLines = unifiedDiffLines(oldContent, codeContent);
      diffs.push([fileName, diffLines, action]);

      if (overwrite) {
        ensureDir(path.dirname(path.resolve(filePath)));
        writeFile(filePath, codeContent);
        writtenFiles.push({ fileName, filePath, action });
        onLog(isNewFile
          ? `🆕 Created: ${filePath} (${codeContent.length} characters)`
          : `💾 Saved: ${filePath} (${codeContent.length} characters)`);
      } else {
        onLog(isNewFile ? `⚠️ New file diff prepared: ${fileName}` : `⚠️ Diff prepared: ${fileName}`);
      }
    }

    let reportPath = null;
    if (!overwrite && diffs.length > 0) {
      reportPath = path.join(reportDir, `diff_${Date.now()}.html`);
      generateDiffHtml(diffs, reportPath);
      onLog(`📊 Diff report saved: ${reportPath}`);
      if (openReport) await openReport(reportPath);
    }

    return { needMoreInfo: false, diffs, writtenFiles, reportPath, explanationHtml };
  } catch (e) {
    onLog(`❌ Error extracting code: ${e.message}`);
    return null;
  }
}

module.exports = { processResponse };
