'use strict';

const fs = require('fs');
const path = require('path');
const { readFile } = require('./fileOps');

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules', 'vendor', '.venv', 'venv', 'env', '__pycache__',
  'site-packages', '.pip', 'bower_components', 'jspm_packages',
  'dist', 'build', 'out', '.next', '.nuxt', '.output', 'target', 'bin', 'obj',
  '.git', '.svn', '.hg', '.idea', '.vscode',
  '.DS_Store', 'Thumbs.db',
  'coverage', '.cache', '.pytest_cache', '.mypy_cache', 'htmlcoverage',
];

const DEFAULT_IGNORE_EXTENSIONS = [
  '.log', '.tmp', '.temp', '.suo', '.user',
  'package-lock.json', 'yarn.lock', 'composer.lock', 'Pipfile.lock', 'poetry.lock',
];

function loadIgnorePatterns(currentDir) {
  const patterns = new Set(DEFAULT_IGNORE_PATTERNS);
  const extPatterns = new Set(DEFAULT_IGNORE_EXTENSIONS);

  for (const ignoreFile of ['.gitignore', '.codientignore']) {
    const ignorePath = path.join(currentDir, ignoreFile);
    if (fs.existsSync(ignorePath) && fs.statSync(ignorePath).isFile()) {
      try {
        const content = readFile(ignorePath);
        for (let line of content.split(/\r\n|\r|\n/)) {
          line = line.trim();
          if (!line || line.startsWith('#')) continue;
          const clean = line.replace(/\/+$/, '');
          if (clean.startsWith('*.')) {
            extPatterns.add(clean.slice(1));
          } else {
            patterns.add(clean);
          }
        }
      } catch {
      }
    }
  }

  return { dirs: patterns, exts: extPatterns };
}

function buildTree(currentDir, maxDepth = 3) {
  const { dirs: ignoreDirs, exts: ignoreExts } = loadIgnorePatterns(currentDir);
  const lines = [`${path.basename(currentDir)}/`];

  function walk(currentPath, prefix, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(currentPath).sort();
    } catch {
      return;
    }

    const filtered = [];
    for (const entry of entries) {
      const full = path.join(currentPath, entry);
      if (ignoreDirs.has(entry)) continue;
      let isFile = false;
      try {
        isFile = fs.statSync(full).isFile();
      } catch {
        continue;
      }
      if (isFile) {
        const ext = path.extname(entry);
        if (ignoreExts.has(ext) || ignoreExts.has(entry)) continue;
      }
      filtered.push(entry);
    }

    filtered.forEach((entry, i) => {
      const isLast = i === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const full = path.join(currentPath, entry);
      const isDir = fs.statSync(full).isDirectory();
      if (isDir) {
        lines.push(`${prefix}${connector}${entry}/`);
        const extension = isLast ? '    ' : '│   ';
        walk(full, prefix + extension, depth + 1);
      } else {
        lines.push(`${prefix}${connector}${entry}`);
      }
    });
  }

  walk(currentDir, '', 1);
  return lines.join('\n');
}

module.exports = { loadIgnorePatterns, buildTree };
