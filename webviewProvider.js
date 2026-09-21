'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const core = require('./core');

const CHAT_IDS_STATE_KEY = 'codient.chatIds';

class ChatViewProvider {
  constructor(context, options = {}) {
    this.context = context;
    this.onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
    this.view = null;
    this.busy = false;
    this.activeEditorListenerRegistered = false;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === 'ask') {
          await this.handleAsk(msg);
        } else if (msg.type === 'pickFiles') {
          await this.handlePickFiles(msg);
        } else if (msg.type === 'saveHtml') {
          await this.handleSaveHtml(msg);
        } else if (msg.type === 'ready') {
          this.pushActiveFile();
        }
      } catch (e) {
        this.post({ type: 'error', text: e.message });
        if (!this.busy) this.post({ type: 'busy', value: false });
      }
    });

    if (!this.activeEditorListenerRegistered) {
      this.activeEditorListenerRegistered = true;
      this.context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => this.pushActiveFile())
      );
    }

    this.pushActiveFile();
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  getWorkspaceRoot() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? folder.uri.fsPath : null;
  }

  getConfig(key, fallback) {
    return vscode.workspace.getConfiguration('codient').get(key, fallback);
  }

  getActiveFileRelative() {
    const cwd = this.getWorkspaceRoot();
    const editor = vscode.window.activeTextEditor;
    if (!cwd || !editor) return null;
    if (editor.document.uri.scheme !== 'file') return null;
    const fsPath = editor.document.uri.fsPath;
    if (!fsPath.startsWith(cwd + path.sep)) return null;
    return path.relative(cwd, fsPath);
  }

  pushActiveFile() {
    this.post({ type: 'activeFile', file: this.getActiveFileRelative() });
  }

  async findAllFiles(cwd) {
    const excludeDirs = this.getConfig('excludeDirs', []);
    const excludeGlob = excludeDirs.length ? `**/{${excludeDirs.join(',')}}/**` : undefined;
    const uris = await vscode.workspace.findFiles('**/*', excludeGlob, 5000);
    return uris
      .map((u) => path.relative(cwd, u.fsPath))
      .filter((p) => p && !p.startsWith('..'))
      .sort();
  }

  async handlePickFiles(msg) {
    const cwd = this.getWorkspaceRoot();
    if (!cwd) return;
    const allFiles = await this.findAllFiles(cwd);
    const picked = await vscode.window.showQuickPick(allFiles, {
      canPickMany: true,
      placeHolder: msg.target === 'context' ? 'Context Files (read-only)' : 'Files to Edit',
      title: msg.target === 'context' ? 'Context Files' : 'Files to Edit',
    });
    if (!picked) return;
    this.post({ type: 'filesPicked', target: msg.target, files: picked });
  }

  getEffectiveModelKey() {
    const model = this.getConfig('model', 'Default');
    if (model === 'Default') return 'deepseek';
    return model.toLowerCase();
  }

  getChatIdsMap() {
    return this.context.workspaceState.get(CHAT_IDS_STATE_KEY, {});
  }

  async setChatIdForModel(modelKey, chatId) {
    const map = this.getChatIdsMap();
    map[modelKey] = chatId;
    await this.context.workspaceState.update(CHAT_IDS_STATE_KEY, map);
  }

  async handleAsk(msg) {
    if (this.busy) {
      this.post({ type: 'error', text: 'A request is already running. Please wait for it to finish.' });
      return;
    }

    const cwd = this.getWorkspaceRoot();
    if (!cwd) {
      this.post({ type: 'error', text: 'Please open a workspace.' });
      this.post({ type: 'busy', value: false });
      return;
    }

    this.busy = true;
    this.post({ type: 'busy', value: true });

    try {
      const modelKey = this.getEffectiveModelKey();
      const chatId = this.getChatIdsMap()[modelKey] || null;
      const files = [...new Set(msg.files || [])];

      const result = await core.runTask({
        question: msg.text,
        files,
        contextFiles: msg.contextFiles || [],
        overwrite: true,
        model: modelKey,
        profile: this.getConfig('profile', 'default'),

        proxy: this.getConfig('proxy', '') || null,
        chatId,
        cwd,
        nonInteractive: true,
        onLog: (line) => this.onLog(line),
      });

      if (result.chat && result.chat.newChatUrl) {
        const parsed = result.chat.newChatUrl.split('/').filter(Boolean).pop();
        if (parsed) await this.setChatIdForModel(modelKey, parsed);
      }

      if (result.success) {
        const diffs = (result.diffs || []).map(([fileName, diffLines, action]) => ({
          fileName,
          action,
          text: Array.isArray(diffLines) ? diffLines.join('\n') : String(diffLines),
        }));
        this.post({
          type: 'done',
          explanationHtml: result.explanationHtml || '',
          writtenFiles: (result.writtenFiles || []).map((f) => f.fileName),
          diffs,
        });
      } else {
        this.post({
          type: 'error',
          text: result.error || 'The request failed. See the Codient output panel for details.',
        });
      }
    } finally {
      this.busy = false;

      this.post({ type: 'busy', value: false });
    }
  }

  async handleSaveHtml(msg) {
    const html = String(msg.html || '');
    if (!html) return;

    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const baseDir = this.getWorkspaceRoot() || os.homedir();

    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(baseDir, `codient-chat-${stamp}.html`)),
      filters: { HTML: ['html'] },
      title: 'Save chat as HTML',
    });
    if (!target) return;

    fs.writeFileSync(target.fsPath, html, 'utf8');
    const choice = await vscode.window.showInformationMessage(`💾 Chat saved: ${path.basename(target.fsPath)}`, 'Open');
    if (choice === 'Open') await vscode.env.openExternal(target);
  }

  getHtml() {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'chat.html');
    return fs.readFileSync(htmlPath, 'utf8');
  }
}

module.exports = { ChatViewProvider };
