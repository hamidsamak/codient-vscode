'use strict';

const fs = require('fs');
const path = require('path');
const Diff = require('diff');
const { readFile, writeFile, ensureDir } = require('./fileOps');

function formatTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function parseTimestamp(ts) {
  const y = ts.slice(0, 4), mo = ts.slice(4, 6), d = ts.slice(6, 8);
  const h = ts.slice(8, 10), mi = ts.slice(10, 12), s = ts.slice(12, 14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
}

function findBackups(backupDir, fileName) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  const pattern = new RegExp(`^${escapeRegex(baseName)}_(\\d{14})${escapeRegex(ext)}$`);

  let entries = [];
  try {
    entries = fs.readdirSync(backupDir);
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    const m = entry.match(pattern);
    if (m) {
      results.push({ timestamp: m[1], date: parseTimestamp(m[1]), fullPath: path.join(backupDir, entry) });
    }
  }
  return results;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showHistory(backupDir, fileName, onLog = console.log) {
  const backups = findBackups(backupDir, fileName).sort((a, b) => b.date - a.date);

  if (backups.length === 0) {
    onLog(`\n❌ No backup versions found for '${fileName}'`);
    return [];
  }

  onLog(`\n📋 Backup history for '${fileName}':`);
  onLog('='.repeat(70));
  backups.forEach((b, i) => {
    onLog(`${i + 1}. Time: ${b.date.toISOString().replace('T', ' ').slice(0, 19)} (timestamp: ${b.timestamp})`);
    onLog(`   Path: ${b.fullPath}`);
  });
  onLog('='.repeat(70));

  return backups;
}

function rollbackFile(backupDir, fileName, cwd, timestamp = null, onLog = console.log) {
  const targetFilePath = path.join(cwd, fileName);

  if (!fs.existsSync(targetFilePath)) {
    onLog(`❌ File '${fileName}' does not exist in current directory`);
    return false;
  }

  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);

  const backups = findBackups(backupDir, fileName);

  let chosen;
  if (timestamp) {
    chosen = backups.find((b) => b.timestamp === timestamp);
    if (!chosen) {
      onLog(`❌ Version with timestamp '${timestamp}' not found for '${fileName}'`);
      return false;
    }
  } else {
    if (backups.length === 0) {
      onLog(`❌ No backup versions found for '${fileName}'`);
      return false;
    }
    chosen = backups.reduce((latest, b) => (b.date > latest.date ? b : latest), backups[0]);
  }

  const currentBackupPath = path.join(backupDir, `${baseName}_${formatTimestamp()}${ext}`);
  const currentContent = readFile(targetFilePath);
  writeFile(currentBackupPath, currentContent);
  onLog(`🗂 Backup of current version: ${currentBackupPath}`);

  const backupContent = readFile(chosen.fullPath);
  writeFile(targetFilePath, backupContent);
  onLog(`✅ File '${fileName}' rolled back to version ${timestamp || `latest (timestamp: ${chosen.timestamp})`}`);
  return true;
}

function unifiedDiffLines(oldContent, newContent) {
  const parts = Diff.diffLines(oldContent, newContent);
  const lines = [];
  for (const part of parts) {
    let partLines = part.value.split('\n');
    if (partLines[partLines.length - 1] === '') partLines.pop();
    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    for (const l of partLines) lines.push(prefix + l);
  }
  return lines;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateDiffHtml(diffs, outputPath) {
  let htmlContent = `
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Codient Diff Report</title>
        <style>
            body { font-family: monospace; background: #111; color: #eee; }
            .file { margin-bottom: 40px; }
            .filename { font-size: 18px; margin: 10px 0; }

            .line {
                display: inline-block;
                white-space: pre;
                padding-left: 6px;
                margin: 0;
            }

            .added { background: #144212; color: #9cff9c; }
            .removed { background: #4a1212; color: #ff9c9c; }
            .same { color: #ccc; }

            .added::before { content: "+ "; color: #6fff6f; user-select: none; }
            .removed::before { content: "- "; color: #ff6f6f; user-select: none; }
            .same::before { content: "  "; user-select: none; }

            pre { padding: 10px; overflow-x: auto; }
        </style>
    </head>
    <body>
    <h1>Codient Diff Report</h1>
    `;

  for (const [fileName, diffLines, action] of diffs) {
    const actionLabel = action === 'create' ? '🆕 NEW FILE' : '✏️ EDITED';
    htmlContent += `<div class='file'><div class='filename'>${actionLabel} &mdash; ${escapeHtml(fileName)}</div><pre>`;

    for (const line of diffLines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      const cleanLine = line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line;
      const escaped = escapeHtml(cleanLine);

      if (line.startsWith('+')) {
        htmlContent += `<span class='line added'>${escaped}</span>\n`;
      } else if (line.startsWith('-')) {
        htmlContent += `<span class='line removed'>${escaped}</span>\n`;
      } else {
        htmlContent += `<span class='line same'>${escaped}</span>\n`;
      }
    }

    htmlContent += '</pre></div>';
  }

  htmlContent += '</body></html>';
  ensureDir(path.dirname(outputPath));
  writeFile(outputPath, htmlContent);
}

module.exports = {
  formatTimestamp,
  findBackups,
  showHistory,
  rollbackFile,
  unifiedDiffLines,
  generateDiffHtml,
};
