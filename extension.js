const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {

    // Command 1: Ask AI about file(s)
    context.subscriptions.push(vscode.commands.registerCommand('deep-insight.ask', async () => {

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace/project folder first!');
            return;
        }

        // Find all code files
        const allFiles = await findCodeFiles(workspaceFolder.uri.fsPath);

        if (allFiles.length === 0) {
            vscode.window.showErrorMessage('No code files found in workspace!');
            return;
        }

        // Step 1: Select files
        const selectedFiles = await vscode.window.showQuickPick(allFiles, {
            canPickMany: true,
            placeHolder: 'Select file(s) to process (use space to select multiple)',
            title: 'Choose Files for AI Analysis'
        });

        if (!selectedFiles || selectedFiles.length === 0) {
            vscode.window.showErrorMessage('No file selected!');
            return;
        }

        // Step 2: Get question
        const question = await vscode.window.showInputBox({
            prompt: 'What would you like the AI to do?',
            placeHolder: 'Add error handling, refactor code, optimize performance...',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Please enter a question';
                }
                return null;
            }
        });

        if (!question) return;

        // Step 3: Ask about context file (optional)
        let contextFile = null;
        const wantContext = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Do you want to provide a context file?',
            title: 'Context File'
        });

        if (wantContext === 'Yes') {
            const allFilesForContext = await findCodeFiles(workspaceFolder.uri.fsPath);
            contextFile = await vscode.window.showQuickPick(allFilesForContext, {
                placeHolder: 'Select context file (for reference)',
                title: 'Choose Context File'
            });
        }

        // Step 4: Ask about overwrite (optional)
        const overwrite = await vscode.window.showQuickPick(['No', 'Yes'], {
            placeHolder: 'Overwrite the selected file(s)?',
            title: 'Overwrite Mode'
        });

        // Step 5: Build command
        const workspacePath = workspaceFolder.uri.fsPath;
        let command = `deep-insight "${question}"`;

        // Add context if selected
        if (contextFile && contextFile !== 'No') {
            command += ` --context "${path.join(workspacePath, contextFile)}"`;
        }

        // Add overwrite if selected
        if (overwrite === 'Yes') {
            command += ' --overwrite';
        }

        // Add all selected files at the end
        const filePaths = selectedFiles.map(f => `"${path.join(workspacePath, f)}"`).join(' ');
        command += ` ${filePaths}`;

        // Execute in terminal
        const terminal = vscode.window.createTerminal('Deep Insight');
        terminal.show();
        terminal.sendText(command);

        // Show confirmation message
        const fileCount = selectedFiles.length;
        vscode.window.showInformationMessage(`🤖 Sending ${fileCount} file(s) to AI...`);
    }));

    // Command 2: Open Browser Session
    context.subscriptions.push(vscode.commands.registerCommand('deep-insight.browser', () => {
        const terminal = vscode.window.createTerminal('Deep Insight');
        terminal.show();
        terminal.sendText('deep-insight --browser');
        vscode.window.showInformationMessage('🌐 Browser opened. Login and close when done.');
    }));

    // Command 3: Ask AI about current file
    context.subscriptions.push(vscode.commands.registerCommand('deep-insight.askCurrent', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Open a file first!');
            return;
        }

        // Step 1: Get the user's request
        const question = await vscode.window.showInputBox({
            prompt: 'What would you like the AI to do?',
            placeHolder: 'Fix this code, add comments, optimize performance...',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Please enter a question';
                }
                return null;
            }
        });
        if (!question) return;

        // Step 2: Ask about context file (optional)
        let contextFile = null;
        const wantContext = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Do you want to provide a context file?',
            title: 'Context File'
        });

        if (wantContext === 'Yes') {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const allFiles = await findCodeFiles(workspaceFolder.uri.fsPath);
                contextFile = await vscode.window.showQuickPick(allFiles, {
                    placeHolder: 'Select context file (for reference)',
                    title: 'Choose Context File'
                });
            }
        }

        // Step 3: Ask about overwrite (optional)
        const overwrite = await vscode.window.showQuickPick(['No', 'Yes'], {
            placeHolder: 'Overwrite the current file?',
            title: 'Overwrite Mode'
        });

        // Step 4: Build and execute command
        const currentFile = editor.document.fileName;
        let command = `deep-insight "${question}"`;

        if (contextFile && contextFile !== 'No') {
            const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            command += ` --context "${path.join(workspacePath, contextFile)}"`;
        }

        if (overwrite === 'Yes') {
            command += ' --overwrite';
        }

        command += ` "${currentFile}"`;

        const terminal = vscode.window.createTerminal('Deep Insight');
        terminal.show();
        terminal.sendText(command);

        vscode.window.showInformationMessage(`🤖 Sending request to AI...`);
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