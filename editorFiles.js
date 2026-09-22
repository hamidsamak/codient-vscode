'use strict';

const vscode = require('vscode');
const path = require('path');

// Returns the workspace-relative paths of files currently open in any editor tab group,
// sorted alphabetically. Used to show "Open Editors" first when picking files.
function getOpenEditorFiles(cwd) {
  const files = new Set();
  try {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText && input.uri) {
          const fsPath = input.uri.fsPath;
          if (fsPath && fsPath.startsWith(cwd + path.sep)) {
            const rel = path.relative(cwd, fsPath);
            if (rel && !rel.startsWith('..')) {
              files.add(rel);
            }
          }
        }
      }
    }
  } catch {
  }
  return [...files].sort();
}

module.exports = { getOpenEditorFiles };