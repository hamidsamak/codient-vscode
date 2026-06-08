const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function getModelFlag() {
    const config = vscode.workspace.getConfiguration('codient');
    const model = config.get('defaultModel', 'default');
    if (model === 'default') return '';
    return ` --model ${model}`;
}

function getProxyFlag() {
    const config = vscode.workspace.getConfiguration('codient');
    const proxy = config.get('proxy', '').trim();
    if (!proxy) return '';
    return ` --proxy ${proxy}`;
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
        let command = `codient "${question.trim()}"`;

        command += getModelFlag();
        command += getProxyFlag();

        if (overwrite === 'Yes') {
            command += ' --overwrite';
        }

        if (contextFiles.length > 0) {
            const contextPaths = contextFiles.map(f => `"${path.join(workspacePath, f)}"`).join(' ');
            command += ` --context ${contextPaths}`;
        }

        command += ' --';

        const filePaths = selectedFiles.map(f => `"${path.join(workspacePath, f)}"`).join(' ');
        command += ` ${filePaths}`;

        const terminal = vscode.window.createTerminal('Codient');
        terminal.show();
        terminal.sendText(command);

        const fileCount = selectedFiles.length;
        const contextCount = contextFiles.length;
        vscode.window.showInformationMessage(`🤖 Sending ${fileCount} main file(s) with ${contextCount} context file(s) to AI...`);
    }));

    // Command 2: Open Browser Session
    context.subscriptions.push(vscode.commands.registerCommand('codient.browser', () => {
        const terminal = vscode.window.createTerminal('Codient');
        terminal.show();
        terminal.sendText('codient --browser');
        vscode.window.showInformationMessage('🌐 Codient browser session opened. Login and close when done.');
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
        let command = `codient "${question.trim()}"`;

        command += getModelFlag();
        command += getProxyFlag();

        if (overwrite === 'Yes') {
            command += ' --overwrite';
        }

        command += ` -- "${currentFile}"`;

        const terminal = vscode.window.createTerminal('Codient');
        terminal.show();
        terminal.sendText(command);

        vscode.window.showInformationMessage(`🤖 Sending request to AI...`);
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

        let command = `codient "${question.trim()}"`;
        command += getModelFlag();
        command += getProxyFlag();
        command += ' --overwrite';

        const terminal = vscode.window.createTerminal({
            name: 'Codient',
            cwd: workspaceFolder.uri.fsPath
        });
        terminal.show();
        terminal.sendText(command);

        vscode.window.showInformationMessage(`🆕 Asking AI to create new file(s) in ${workspaceFolder.uri.fsPath}...`);
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