const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let outputChannel;

function getOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Codient');
  }
  return outputChannel;
}

function getModelArgs() {
  const config = vscode.workspace.getConfiguration('codient');
  const model = config.get('model', 'default');
  if (model === 'default') return [];
  return ['--model', model];
}

function getProxyArgs() {
  const config = vscode.workspace.getConfiguration('codient');
  const proxy = config.get('proxy', '').trim();
  if (!proxy) return [];
  return ['--proxy', proxy];
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

    proc.stdout.on('data', (data) => {
      channel.append(data.toString());
    });

    proc.stderr.on('data', (data) => {
      channel.append(data.toString());
    });

    proc.on('close', (code) => {
      channel.appendLine('─'.repeat(60));
      if (code === 0) {
        channel.appendLine('✅ Done.');
        resolve();
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
    // Step 2: Main files
    const allFiles = await findCodeFiles(workspacePath);
    if (allFiles.length === 0) {
      vscode.window.showErrorMessage('No code files found in workspace!');
      return null;
    }

    // Pre-select active editor if open
    const activeFile = vscode.window.activeTextEditor?.document.fileName;
    const activeRelative = activeFile ? path.relative(workspacePath, activeFile) : null;

    const fileItems = allFiles.map(f => ({
      label: f,
      picked: f === activeRelative
    }));

    selectedFiles = await vscode.window.showQuickPick(fileItems, {
      canPickMany: true,
      placeHolder: 'Select file(s) to edit (active file pre-selected)',
      title: 'Files to Edit'
    });

    selectedFiles = selectedFiles.map(f => f.label);
  }

  // Step 3: Context files (based on default setting)
  let contextFiles = [];
  const pick = await vscode.window.showQuickPick(['No', 'Yes'], {
    placeHolder: 'Add context files (read-only reference)?',
    title: 'Context Files'
  });
  wantContext = pick ?? 'No';

  if (wantContext === 'Yes') {
    const allFiles = await findCodeFiles(workspacePath);
    const contextItems = await vscode.window.showQuickPick(
      allFiles.filter(f => !selectedFiles.includes(f)).map(f => ({ label: f })),
      {
        canPickMany: true,
        placeHolder: 'Select context file(s) (read-only, for reference)',
        title: 'Context Files'
      }
    );
    if (contextItems && contextItems.length > 0) {
      contextFiles = contextItems.map(f => f.label);
    }
  }

  return { question: question.trim(), selectedFiles, contextFiles };
}

function buildArgs(question, selectedFiles, contextFiles, workspacePath, overwrite) {
  const args = ['"' + question.replace(/"/g, '\\"') + '"'];
  args.push(...getModelArgs());
  args.push(...getProxyArgs());

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

  // Command 1: Ask — question first, then files, then context. Always overwrites.
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

    vscode.window.showInformationMessage(`🤖 Sending to AI... (${selectedFiles.length} file(s))`);

    try {
      await runCodient(args, workspacePath);
      vscode.window.showInformationMessage('✅ Codient applied changes.');
    } catch (err) {
      vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
    }
  }));

  // Command 2: Preview — question first, then files, then context. No overwrite → opens browser.
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

    vscode.window.showInformationMessage(`🔍 Previewing changes in browser...`);

    try {
      await runCodient(args, workspacePath);
    } catch (err) {
      vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
    }
  }));

  // Command 3: Open Browser Session
  context.subscriptions.push(vscode.commands.registerCommand('codient.browser', async () => {
    vscode.window.showInformationMessage('🌐 Codient browser session opened. Login and close when done.');
    try {
      await runCodient(['--browser', ...getModelArgs(), ...getProxyArgs()]);
    } catch (err) {
      vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
    }
  }));
}

// Find all code files in directory
async function findCodeFiles(dir) {
  const codeExtensions = ['.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb', '.html', '.css', '.json'];
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'venv', 'env', '.venv'];

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