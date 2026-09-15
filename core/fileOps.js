'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function splitLines(content) {
  if (content === '') return [];
  return content.split(/\r\n|\r|\n/);
}

function numberLines(content) {
  const lines = splitLines(content);
  if (lines.length === 0) return content;
  const width = String(lines.length).length;
  return lines
    .map((line, i) => `${String(i + 1).padStart(width, ' ')}: ${line}`)
    .join('\n');
}

function parseHunks(content) {
  const hunkPattern = /<hunk\s+op="(?<op>replace|add|delete)"(?:\s+start="(?<start>\d+)")?(?:\s+end="(?<end>\d+)")?(?:\s+after="(?<after>\d+)")?\s*(?:\/>|>(?:<!\[CDATA\[)?(?<content>.*?)(?:\]\]>)?\s*<\/hunk>)/gs;

  const hunks = [];
  let m;
  while ((m = hunkPattern.exec(content)) !== null) {
    const { op, start, end, after, content: hunkContent } = m.groups;
    const h = { op };

    if (op === 'replace' || op === 'delete') {
      if (start === undefined || end === undefined) continue;
      h.start = parseInt(start, 10);
      h.end = parseInt(end, 10);
    }

    if (op === 'add') {
      if (after === undefined) continue;
      h.after = parseInt(after, 10);
    }

    if (op === 'replace' || op === 'add') {
      h.content = (hunkContent || '').replace(/^\n+|\n+$/g, '');
    }

    hunks.push(h);
  }

  return hunks;
}

function applyHunks(oldContent, hunks) {
  const lines = splitLines(oldContent);

  const sortKey = (h) => (h.op === 'add' ? h.after : h.start);
  const sorted = [...hunks].sort((a, b) => sortKey(b) - sortKey(a));

  for (const h of sorted) {
    if (h.op === 'replace') {
      const newLines = h.content ? h.content.split('\n') : [];
      lines.splice(h.start - 1, h.end - h.start + 1, ...newLines);
    } else if (h.op === 'delete') {
      lines.splice(h.start - 1, h.end - h.start + 1);
    } else if (h.op === 'add') {
      const newLines = h.content ? h.content.split('\n') : [];
      lines.splice(h.after, 0, ...newLines);
    }
  }

  let result = lines.join('\n');
  if (oldContent.endsWith('\n') && !result.endsWith('\n')) {
    result += '\n';
  }
  return result;
}

module.exports = {
  ensureDir,
  readFile,
  writeFile,
  splitLines,
  numberLines,
  parseHunks,
  applyHunks,
  path,
};
