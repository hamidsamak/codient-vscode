const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let outputChannel;
let chatIdStatusBarItem;
let extensionContext;

const MODEL_OPTIONS = [
  { label: 'Default',  value: 'Default'  },
  { label: 'Claude',   value: 'Claude'   },
  { label: 'ChatGPT',  value: 'ChatGPT'  },
  { label: 'Gemini', value: 'Gemini' },
  { label: 'DeepSeek', value: 'DeepSeek' },
];

const MODEL_URL_PATTERNS = {
  claude:   /claude\.ai\/chat\/([a-zA-Z0-9-]+)/,
  chatgpt:  /chatgpt\.com\/c\/([a-zA-Z0-9-]+)/,
  gemini:   /gemini\.google\.com\/app\/([a-zA-Z0-9-]+)/,
  deepseek: /chat\.deepseek\.com\/a\/chat\/s\/([a-zA-Z0-9-]+)/,
};

const MODEL_DISPLAY_NAMES = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

const CHAT_IDS_STATE_KEY = 'codient.chatIds';
const MRU_FILES_STATE_KEY = 'codient.mruFiles';
const LAST_SELECTED_FILES_STATE_KEY = 'codient.lastSelectedFiles';
const MAX_MRU_FILES = 15;

const DEFAULT_CODE_EXTENSIONS = [
  '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.cpp', '.c',
  '.go', '.rs', '.php', '.rb', '.html', '.css', '.scss', '.sass',
  '.less', '.json'
];

const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  'venv', 'env', '.venv'
];

function getOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Codient');
  }
  return outputChannel;
}

function getModelArgs() {
  const config = vscode.workspace.getConfiguration('codient');
  const model = config.get('model', 'Default');
  if (model === 'Default') return [];
  return ['--model', model.toLowerCase()];
}

function getProxyArgs() {
  const config = vscode.workspace.getConfiguration('codient');
  const proxy = config.get('proxy', '').trim();
  if (!proxy) return [];
  return ['--proxy', proxy];
}

function getProfileArgs() {
  const config = vscode.workspace.getConfiguration('codient');
  const profile = config.get('profile', 'default').trim();
  if (!profile || profile === 'default') return [];
  return ['--profile', profile];
}

function getCurrentProfile() {
  const config = vscode.workspace.getConfiguration('codient');
  return config.get('profile', 'default').trim() || 'default';
}

function getCurrentModel() {
  const config = vscode.workspace.getConfiguration('codient');
  return config.get('model', 'Default').trim() || 'Default';
}

function getEffectiveModelKey() {
  const model = getCurrentModel();
  if (model === 'Default') return 'deepseek';
  return model.toLowerCase();
}

function normalizeExtension(ext) {
  if (!ext) return null;
  const trimmed = String(ext).trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function getCodeExtensions() {
  const config = vscode.workspace.getConfiguration('codient');
  const list = config.get('codeExtensions', DEFAULT_CODE_EXTENSIONS);
  const normalized = list.map(normalizeExtension).filter(Boolean);
  return [...new Set(normalized)];
}

function getExcludeDirs() {
  const config = vscode.workspace.getConfiguration('codient');
  const list = config.get('excludeDirs', DEFAULT_EXCLUDE_DIRS);
  const normalized = list.map(d => (d || '').trim()).filter(Boolean);
  return [...new Set(normalized)];
}

function getExistingProfiles() {
  const profilesDir = path.join(os.homedir(), '.codient', 'profiles');
  try {
    if (!fs.existsSync(profilesDir)) return [];
    return fs.readdirSync(profilesDir).filter(name => {
      const fullPath = path.join(profilesDir, name);
      return fs.statSync(fullPath).isDirectory();
    }).sort();
  } catch {
    return [];
  }
}

function getChatIdsMap() {
  return extensionContext.workspaceState.get(CHAT_IDS_STATE_KEY, {});
}

function getChatIdForModel(modelKey) {
  const map = getChatIdsMap();
  return map[modelKey] || null;
}

async function setChatIdForModel(modelKey, chatId) {
  const map = getChatIdsMap();
  map[modelKey] = chatId;
  await extensionContext.workspaceState.update(CHAT_IDS_STATE_KEY, map);
  updateChatIdStatusBar();
}

async function clearChatIdForModel(modelKey) {
  const map = getChatIdsMap();
  delete map[modelKey];
  await extensionContext.workspaceState.update(CHAT_IDS_STATE_KEY, map);
  updateChatIdStatusBar();
}

function getChatIdArgs() {
  const modelKey = getEffectiveModelKey();
  const chatId = getChatIdForModel(modelKey);
  if (!chatId) return [];
  return ['--chat-id', chatId];
}

function parseChatIdInput(rawInput, modelKey) {
  const text = (rawInput || '').trim();
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    const pattern = MODEL_URL_PATTERNS[modelKey];
    if (pattern) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    const segments = text.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : null;
  }

  return text;
}

async function getClipboardSuggestion(modelKey) {
  try {
    const clipboardText = (await vscode.env.clipboard.readText() || '').trim();
    if (!clipboardText) return '';
    const parsed = parseChatIdInput(clipboardText, modelKey);
    return parsed || '';
  } catch {
    return '';
  }
}

function shortenChatId(chatId, length = 10) {
  if (!chatId) return '';
  return chatId.length > length ? `${chatId.slice(0, length)}…` : chatId;
}

function updateChatIdStatusBar() {
  if (!chatIdStatusBarItem) return;

  const modelKey = getEffectiveModelKey();
  const modelName = MODEL_DISPLAY_NAMES[modelKey] || modelKey;
  const chatId = getChatIdForModel(modelKey);

  if (chatId) {
    chatIdStatusBarItem.text = `$(comment-discussion) ${modelName} · ${shortenChatId(chatId)}`;
    chatIdStatusBarItem.tooltip = `Codient — ${modelName}\nChat ID: ${chatId}\nClick to change`;
  } else {
    chatIdStatusBarItem.text = `$(comment) ${modelName} · New Chat`;
    chatIdStatusBarItem.tooltip = `Codient — ${modelName}\nNo chat ID set (a new chat will be started)\nClick to set one`;
  }

  chatIdStatusBarItem.command = 'codient.chatIdMenu';
  chatIdStatusBarItem.show();
}

function runCodient(args, cwd) {
  return new Promise((resolve, reject) => {
    const channel = getOutputChannel();
    channel.clear();
    channel.appendLine('▶ Running: codient ' + args.join(' '));
    channel.appendLine('─'.repeat(60));

    const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const proc = spawn('codient', args, {
      cwd: workspacePath,
      shell: true
    });

    let stdoutBuffer = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;
      channel.append(text);
    });

    proc.stderr.on('data', (data) => {
      channel.append(data.toString());
    });

    proc.on('close', (code) => {
      channel.appendLine('─'.repeat(60));
      if (code === 0) {
        channel.appendLine('✅ Done.');
        resolve({ stdout: stdoutBuffer });
      } else {
        channel.appendLine(`❌ Process exited with code ${code}`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      channel.appendLine(`❌ Error: ${err.message}`);
      reject(err);
    });

    return proc;
  });
}

async function maybeOfferToSaveNewChatId(stdout, wasChatIdPassed) {
  if (wasChatIdPassed) return;

  const match = stdout.match(/CODIENT_NEW_CHAT_URL::([^:]+)::(\S+)/);
  if (!match) return;

  const modelKey = match[1].toLowerCase();
  const chatUrl = match[2];
  const parsedId = parseChatIdInput(chatUrl, modelKey);
  if (!parsedId) return;

  const modelName = MODEL_DISPLAY_NAMES[modelKey] || modelKey;
  const choice = await vscode.window.showInformationMessage(
    `🆕 A new ${modelName} chat was started. Save it for future Codient commands?`,
    'Save',
    'Not now'
  );

  if (choice === 'Save') {
    await setChatIdForModel(modelKey, parsedId);
    vscode.window.showInformationMessage(`💾 Codient will continue using this ${modelName} chat.`);
  }
}

async function pickProfile() {
  const existing = getExistingProfiles();
  const current = getCurrentProfile();

  const NEW_PROFILE_OPTION = '$(plus) Enter new profile name...';

  const items = existing.map(name => ({
    label: name,
    description: name === current ? '← current' : '',
    picked: name === current,
  }));

  items.push({ label: NEW_PROFILE_OPTION, description: '' });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Current profile: ${current} — pick or create one`,
    title: 'Switch Codient Profile',
  });

  if (!picked) return null;

  if (picked.label === NEW_PROFILE_OPTION) {
    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new profile name',
      placeHolder: 'e.g. work, personal, client-x',
      validateInput: (value) => {
        if (!value || value.trim() === '') return 'Profile name cannot be empty.';
        if (!/^[\w\-]+$/.test(value.trim())) return 'Only letters, numbers, dashes, and underscores are allowed.';
        return null;
      }
    });
    if (!newName || newName.trim() === '') return null;
    return newName.trim();
  }

  return picked.label;
}

// ---------------------------------------------------------------------------
// File usage tracking: open editors, MRU (recently used) files, and the
// last full selection, so the file-picker can surface likely-relevant files
// first instead of forcing the user to scroll/search a flat list every time.
// ---------------------------------------------------------------------------

function getOpenEditorFiles(workspacePath) {
  const files = new Set();
  try {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText && input.uri) {
          const fsPath = input.uri.fsPath;
          if (fsPath && fsPath.startsWith(workspacePath + path.sep)) {
            const rel = path.relative(workspacePath, fsPath);
            if (rel && !rel.startsWith('..')) {
              files.add(rel);
            }
          }
        }
      }
    }
  } catch {
    // tabGroups API not available in some environments; fail silently.
  }
  return [...files].sort();
}

function getMruFiles() {
  return extensionContext.workspaceState.get(MRU_FILES_STATE_KEY, []);
}

function getLastSelectedFiles() {
  return extensionContext.workspaceState.get(LAST_SELECTED_FILES_STATE_KEY, []);
}

async function recordFileUsage(selectedFiles) {
  if (!selectedFiles || selectedFiles.length === 0) return;

  const currentMru = getMruFiles();
  const newMru = [
    ...selectedFiles,
    ...currentMru.filter(f => !selectedFiles.includes(f))
  ].slice(0, MAX_MRU_FILES);

  await extensionContext.workspaceState.update(MRU_FILES_STATE_KEY, newMru);
  await extensionContext.workspaceState.update(LAST_SELECTED_FILES_STATE_KEY, selectedFiles);
}

// Builds a grouped QuickPick item list: Open Editors -> Recently Used -> All Files.
// Each file appears in exactly one group (first match wins), so there's no duplication.
function buildGroupedFileItems(workspacePath, allFiles, options = {}) {
  const { activeRelative = null, excludeFiles = [], preselectOpenFiles = true } = options;
  const excludeSet = new Set(excludeFiles);
  const allFilesSet = new Set(allFiles);

  const openFiles = getOpenEditorFiles(workspacePath)
    .filter(f => !excludeSet.has(f));

  const openSet = new Set(openFiles);

  const mruFiles = getMruFiles()
    .filter(f => !excludeSet.has(f) && !openSet.has(f))
    .filter(f => allFilesSet.has(f) || fs.existsSync(path.join(workspacePath, f)));

  const mruSet = new Set(mruFiles);

  const remaining = allFiles.filter(f => !excludeSet.has(f) && !openSet.has(f) && !mruSet.has(f));

  const items = [];

  if (openFiles.length > 0) {
    items.push({ label: 'Open Editors', kind: vscode.QuickPickItemKind.Separator });
    openFiles.forEach(f => items.push({ label: f, picked: preselectOpenFiles && f === activeRelative }));
  }

  if (mruFiles.length > 0) {
    items.push({ label: 'Recently Used', kind: vscode.QuickPickItemKind.Separator });
    mruFiles.forEach(f => items.push({ label: f, picked: false }));
  }

  if (remaining.length > 0) {
    items.push({ label: 'All Files', kind: vscode.QuickPickItemKind.Separator });
    remaining.forEach(f => items.push({ label: f, picked: f === activeRelative }));
  }

  return items;
}

// Offers to reuse the last full file selection, when one exists and every
// file in it still exists on disk. Returns:
//  - an array of relative paths if the user chose to reuse it
//  - null if the user wants to pick manually (or there's nothing to reuse)
async function maybeReuseLastSelection(workspacePath) {
  const lastSelected = getLastSelectedFiles();
  if (!lastSelected || lastSelected.length === 0) return null;

  const stillExisting = lastSelected.filter(f => fs.existsSync(path.join(workspacePath, f)));
  if (stillExisting.length === 0) return null;

  const label = stillExisting.length === 1
    ? `$(history) Reuse last selection: ${stillExisting[0]}`
    : `$(history) Reuse last selection (${stillExisting.length} files)`;

  const picked = await vscode.window.showQuickPick(
    [
      { label, action: 'reuse' },
      { label: '$(list-selection) Pick files manually', action: 'manual' },
    ],
    {
      placeHolder: 'Which files should be edited?',
      title: 'Select Files to Edit',
    }
  );

  if (!picked || picked.action === 'manual') return null;
  return stillExisting;
}

async function promptQuestionAndFiles(workspacePath, options = {}) {
  const { skipFiles = false } = options;

  // Step 1: Question
  const question = await vscode.window.showInputBox({
    prompt: 'What would you like the AI to do?',
    placeHolder: 'Add error handling, refactor code, create a new module...',
    validateInput: (value) => {
      if (!value || value.trim() === '') return 'Please enter a question.';
      return null;
    }
  });
  if (!question || question.trim() === '') {
    vscode.window.showWarningMessage('Operation cancelled: No question provided.');
    return null;
  }

  let selectedFiles = [];
  if (!skipFiles) {
    // Step 2: Main files — offer to reuse the last selection first.
    const reused = await maybeReuseLastSelection(workspacePath);

    if (reused) {
      selectedFiles = reused;
    } else {
      const allFiles = await findCodeFiles(workspacePath);
      if (allFiles.length === 0) {
        vscode.window.showErrorMessage('No code files found in workspace!');
        return null;
      }

      // Pre-select active editor if open (only used inside the "All Files" group;
      // if the active file is already open/MRU it's already pre-selected there).
      const activeFile = vscode.window.activeTextEditor?.document.fileName;
      const activeRelative = activeFile ? path.relative(workspacePath, activeFile) : null;

      const fileItems = buildGroupedFileItems(workspacePath, allFiles, { activeRelative });

      const picked = await vscode.window.showQuickPick(fileItems, {
        canPickMany: true,
        placeHolder: 'Select file(s) to edit (open editors pre-selected)',
        title: 'Files to Edit'
      });

      if (!picked || picked.length === 0) {
        vscode.window.showWarningMessage('Operation cancelled: No files selected.');
        return null;
      }

      selectedFiles = picked.map(f => f.label);
    }

    await recordFileUsage(selectedFiles);
  }

  // Step 3: Context files
  let contextFiles = [];
  const pick = await vscode.window.showQuickPick(['No', 'Yes'], {
    placeHolder: 'Add context files (read-only reference)?',
    title: 'Context Files'
  });
  const wantContext = pick ?? 'No';

  if (wantContext === 'Yes') {
    const allFiles = await findCodeFiles(workspacePath);
    const contextItems = buildGroupedFileItems(workspacePath, allFiles, {
      excludeFiles: selectedFiles,
      preselectOpenFiles: false,
    });

    const picked = await vscode.window.showQuickPick(contextItems, {
      canPickMany: true,
      placeHolder: 'Select context file(s) (read-only, for reference)',
      title: 'Context Files'
    });
    if (picked && picked.length > 0) {
      contextFiles = picked.map(f => f.label);
    }
  }

  return { question: question.trim(), selectedFiles, contextFiles };
}

function buildArgs(question, selectedFiles, contextFiles, workspacePath, overwrite) {
  const args = ['"' + question.replace(/"/g, '\\"') + '"'];
  args.push(...getModelArgs());
  args.push(...getProxyArgs());
  args.push(...getProfileArgs());
  args.push(...getChatIdArgs());
  args.push('--non-interactive');

  if (overwrite) args.push('--overwrite');

  if (contextFiles.length > 0) {
    args.push('--context');
    contextFiles.forEach(f => args.push(path.join(workspacePath, f)));
  }

  if (selectedFiles.length > 0) {
    args.push('--');
    selectedFiles.forEach(f => args.push(path.join(workspacePath, f)));
  }

  return args;
}

function activate(context) {
  extensionContext = context;

  chatIdStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(chatIdStatusBarItem);
  updateChatIdStatusBar();

  // Command 1: Ask — always overwrites
  context.subscriptions.push(vscode.commands.registerCommand('codient.ask', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('Please open a workspace/project folder first!');
      return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const result = await promptQuestionAndFiles(workspacePath);
    if (!result) return;

    const { question, selectedFiles, contextFiles } = result;
    const args = buildArgs(question, selectedFiles, contextFiles, workspacePath, true);
    const hadChatId = getChatIdArgs().length > 0;

    vscode.window.showInformationMessage(`🤖 Sending to AI... (profile: ${getCurrentProfile()}, ${selectedFiles.length} file(s))`);

    try {
      const { stdout } = await runCodient(args, workspacePath);
      vscode.window.showInformationMessage('✅ Codient applied changes.');
      await maybeOfferToSaveNewChatId(stdout, hadChatId);
    } catch (err) {
      vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
    }
  }));

  // Command 2: Preview — no overwrite, opens diff in browser
  context.subscriptions.push(vscode.commands.registerCommand('codient.preview', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('Please open a workspace/project folder first!');
      return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const result = await promptQuestionAndFiles(workspacePath);
    if (!result) return;

    const { question, selectedFiles, contextFiles } = result;
    const args = buildArgs(question, selectedFiles, contextFiles, workspacePath, false);
    const hadChatId = getChatIdArgs().length > 0;

    vscode.window.showInformationMessage(`🔍 Previewing changes in browser... (profile: ${getCurrentProfile()})`);

    try {
      const { stdout } = await runCodient(args, workspacePath);
      await maybeOfferToSaveNewChatId(stdout, hadChatId);
    } catch (err) {
      vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
    }
  }));

  // Command 3: Open Browser Session (uses current profile)
  context.subscriptions.push(vscode.commands.registerCommand('codient.browser', async () => {
    const profile = getCurrentProfile();
    const modelKey = getEffectiveModelKey();
    const modelName = MODEL_DISPLAY_NAMES[modelKey] || modelKey;
    const chatIdArgs = getChatIdArgs();

    const chatInfo = chatIdArgs.length > 0
      ? `continuing existing ${modelName} chat`
      : `new ${modelName} chat`;

    vscode.window.showInformationMessage(`🌐 Codient browser session opened (profile: ${profile}, ${chatInfo}). Login and close when done.`);
    try {
      await runCodient(['--browser', '--profile', profile, ...getModelArgs(), ...getProxyArgs(), ...chatIdArgs]);
    } catch (err) {
      vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
    }
  }));

  // Command 4: Switch Profile
  context.subscriptions.push(vscode.commands.registerCommand('codient.switchProfile', async () => {
    const selected = await pickProfile();
    if (!selected) return;

    const config = vscode.workspace.getConfiguration('codient');
    await config.update('profile', selected, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`👤 Codient profile switched to: ${selected}`);
  }));

  // Command 5: Switch Model
  context.subscriptions.push(vscode.commands.registerCommand('codient.switchModel', async () => {
    const config = vscode.workspace.getConfiguration('codient');
    const currentModel = getCurrentModel();

    const items = MODEL_OPTIONS.map(m => ({
      label: m.value === currentModel ? `${m.label} ← current` : m.label,
      value: m.value,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Current model: ${currentModel} — pick a model`,
      title: 'Switch Codient Model',
    });

    if (!picked) return;

    await config.update('model', picked.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`🤖 Codient model switched to: ${picked.label.replace(' ← current', '')}`);
    updateChatIdStatusBar();
  }));

  // Command 6: Set Chat ID (for the currently effective model)
  context.subscriptions.push(vscode.commands.registerCommand('codient.setChatId', async () => {
    const modelKey = getEffectiveModelKey();
    const modelName = MODEL_DISPLAY_NAMES[modelKey] || modelKey;

    const clipboardSuggestion = await getClipboardSuggestion(modelKey);

    const input = await vscode.window.showInputBox({
      title: `Set Chat ID — ${modelName}`,
      prompt: `Paste a ${modelName} chat URL or chat ID`,
      placeHolder: 'e.g. https://claude.ai/chat/67797ac7-... or just the ID',
      value: clipboardSuggestion,
      validateInput: (value) => {
        if (!value || value.trim() === '') return 'Please enter a chat URL or ID.';
        return null;
      }
    });

    if (!input) return;

    const parsedId = parseChatIdInput(input, modelKey);
    if (!parsedId) {
      vscode.window.showErrorMessage('Could not parse a chat ID from that input.');
      return;
    }

    await setChatIdForModel(modelKey, parsedId);
    vscode.window.showInformationMessage(`💬 ${modelName} chat ID set: ${shortenChatId(parsedId, 16)}`);
  }));

  // Command 7: Clear Chat ID (for the currently effective model)
  context.subscriptions.push(vscode.commands.registerCommand('codient.clearChatId', async () => {
    const modelKey = getEffectiveModelKey();
    const modelName = MODEL_DISPLAY_NAMES[modelKey] || modelKey;
    const existing = getChatIdForModel(modelKey);

    if (!existing) {
      vscode.window.showInformationMessage(`ℹ️ No chat ID is set for ${modelName}.`);
      return;
    }

    await clearChatIdForModel(modelKey);
    vscode.window.showInformationMessage(`🧹 ${modelName} chat ID cleared. The next request will start a new chat.`);
  }));

  // Command 8: Status bar click menu
  context.subscriptions.push(vscode.commands.registerCommand('codient.chatIdMenu', async () => {
    const modelKey = getEffectiveModelKey();
    const modelName = MODEL_DISPLAY_NAMES[modelKey] || modelKey;
    const existing = getChatIdForModel(modelKey);

    const items = [
      { label: '$(edit) Set Chat ID...', action: 'set' },
      { label: '$(trash) Clear Chat ID', action: 'clear', description: existing ? '' : 'No chat ID set' },
      { label: '$(arrow-swap) Switch Model', action: 'switchModel' },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Codient — ${modelName}${existing ? ` (${shortenChatId(existing)})` : ' (New Chat)'}`,
      title: 'Codient Chat Options',
    });

    if (!picked) return;

    if (picked.action === 'set') {
      await vscode.commands.executeCommand('codient.setChatId');
    } else if (picked.action === 'clear') {
      await vscode.commands.executeCommand('codient.clearChatId');
    } else if (picked.action === 'switchModel') {
      await vscode.commands.executeCommand('codient.switchModel');
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('codient.model')) {
      updateChatIdStatusBar();
    }
  }));
}

// Find all code files in directory
async function findCodeFiles(dir) {
  const codeExtensions = getCodeExtensions();
  const excludeDirs = getExcludeDirs();

  const files = [];

  function walkDirectory(currentPath) {
    const items = fs.readdirSync(currentPath);
    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!excludeDirs.includes(item)) walkDirectory(fullPath);
      } else {
        const ext = path.extname(item).toLowerCase();
        if (codeExtensions.includes(ext)) {
          files.push(path.relative(dir, fullPath));
        }
      }
    }
  }

  walkDirectory(dir);
  return files.sort();
}

module.exports = { activate };