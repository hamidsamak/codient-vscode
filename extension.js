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
    });
}

function activate(context) {

    // Command 1: Ask AI about multiple files (composite mode)
    context.subscriptions.push(vscode.commands.registerCommand('codient.composite', async () => {

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace/project folder first!');
            return;
        }

        const allFiles = await findCodeFiles(workspaceFolder.uri.fsPath);

        if (allFiles.length === 0) {
            vscode.window.showErrorMessage('No code files found in workspace!');
            return;
        }

        const selectedFiles = await vscode.window.showQuickPick(allFiles, {
            canPickMany: true,
            placeHolder: 'Select main file(s) to process (use space to select multiple)',
            title: 'Choose Main Files for AI Analysis'
        });

        if (!selectedFiles || selectedFiles.length === 0) {
            vscode.window.showErrorMessage('No file selected!');
            return;
        }

        const question = await vscode.window.showInputBox({
            prompt: 'What would you like the AI to do?',
            placeHolder: 'Add error handling, refactor code, optimize performance...',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Question cannot be empty! Please enter a valid question.';
                }
                return null;
            }
        });

        if (!question || question.trim() === '') {
            vscode.window.showWarningMessage('Operation cancelled: No question provided.');
            return;
        }

        let contextFiles = [];
        const wantContext = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Do you want to provide context file(s)?',
            title: 'Context Files'
        });

        if (wantContext === 'Yes') {
            const allFilesForContext = await findCodeFiles(workspaceFolder.uri.fsPath);
            contextFiles = await vscode.window.showQuickPick(allFilesForContext, {
                canPickMany: true,
                placeHolder: 'Select context file(s) (for reference) - use space to select multiple',
                title: 'Choose Context Files'
            });

            if (!contextFiles || contextFiles.length === 0) {
                vscode.window.showWarningMessage('No context files selected. Continuing without context...');
                contextFiles = [];
            }
        }

        const overwrite = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Overwrite the selected file(s)?',
            title: 'Overwrite Mode'
        });

        const workspacePath = workspaceFolder.uri.fsPath;

        const args = ['"' + question.trim().replace(/"/g, '\\"') + '"'];
        args.push(...getModelArgs());
        args.push(...getProxyArgs());

        if (overwrite === 'Yes') {
            args.push('--overwrite');
        }

        if (contextFiles.length > 0) {
            args.push('--context');
            contextFiles.forEach(f => args.push(path.join(workspacePath, f)));
        }

        args.push('--');
        selectedFiles.forEach(f => args.push(path.join(workspacePath, f)));

        const fileCount = selectedFiles.length;
        const contextCount = contextFiles.length;
        vscode.window.showInformationMessage(`🤖 Sending ${fileCount} main file(s) with ${contextCount} context file(s) to AI...`);

        try {
            await runCodient(args, workspacePath);
        } catch (err) {
            vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
        }
    }));

    // Command 2: Open Browser Session
    context.subscriptions.push(vscode.commands.registerCommand('codient.browser', async () => {
        vscode.window.showInformationMessage('🌐 Codient browser session opened. Login and close when done.');
        try {
            await runCodient(['--browser']);
        } catch (err) {
            vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
        }
    }));

    // Command 3: Ask AI about current file (simplified)
    context.subscriptions.push(vscode.commands.registerCommand('codient.askCurrent', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Open a file first!');
            return;
        }

        const question = await vscode.window.showInputBox({
            prompt: 'What would you like the AI to do?',
            placeHolder: 'Fix this code, add comments, optimize performance...',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Question cannot be empty! Please enter a valid question.';
                }
                return null;
            }
        });

        if (!question || question.trim() === '') {
            vscode.window.showWarningMessage('Operation cancelled: No question provided.');
            return;
        }

        const overwrite = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Overwrite the current file?',
            title: 'Overwrite Mode'
        });

        const currentFile = editor.document.fileName;

        const args = ['"' + question.trim().replace(/"/g, '\\"') + '"'];
        args.push(...getModelArgs());
        args.push(...getProxyArgs());

        if (overwrite === 'Yes') {
            args.push('--overwrite');
        }

        args.push('--', currentFile);

        vscode.window.showInformationMessage(`🤖 Sending request to AI...`);

        try {
            await runCodient(args);
        } catch (err) {
            vscode.window.showErrorMessage(`Codient failed: ${err.message}`);
        }
    }));

    // Command 4: Create new file(s) from scratch (no input files)
    context.subscriptions.push(vscode.commands.registerCommand('codient.createFiles', async () => {

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace/project folder first!');
            return;
        }

        const question = await vscode.window.showInputBox({
            prompt: 'Describe the file(s) you want the AI to create',
            placeHolder: 'Create a Flask app with app.py and routes.py...',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Description cannot be empty!';
                }
                return null;
            }
        });

        if (!question || question.trim() === '') {
            vscode.window.showWarningMessage('Operation cancelled: No description provided.');
            return;
        }

        const args = ['"' + question.trim().replace(/"/g, '\\"') + '"'];
        args.push(...getModelArgs());
        args.push(...getProxyArgs());
        args.push('--overwrite');

        vscode.window.showInformationMessage(`🆕 Asking AI to create new file(s) in ${workspaceFolder.uri.fsPath}...`);

        try {
            await runCodient(args, workspaceFolder.uri.fsPath);
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
                if (!excludeDirs.includes(item)) {
                    walkDirectory(fullPath);
                }
            } else {
                const ext = path.extname(item).toLowerCase();
                if (codeExtensions.includes(ext)) {
                    const relativePath = path.relative(dir, fullPath);
                    files.push(relativePath);
                }
            }
        }
    }

    walkDirectory(dir);
    return files.sort();
}

module.exports = { activate };