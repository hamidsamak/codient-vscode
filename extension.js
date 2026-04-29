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

        // Select files (like Ctrl+P)
        const selectedFiles = await vscode.window.showQuickPick(allFiles, {
            canPickMany: true,
            placeHolder: 'Select file(s) to process (use space to select multiple)',
            title: 'Choose Files for AI Analysis'
        });

        if (!selectedFiles || selectedFiles.length === 0) {
            vscode.window.showErrorMessage('No file selected!');
            return;
        }

        // Get question
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

        // Build full file paths
        const workspacePath = workspaceFolder.uri.fsPath;
        const filePaths = selectedFiles.map(f => `"${path.join(workspacePath, f)}"`).join(' ');

        // Execute in terminal
        const terminal = vscode.window.createTerminal('Deep Insight');
        terminal.show();
        terminal.sendText(`deep-insight "${question}" ${filePaths}`);

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

        const question = await vscode.window.showInputBox({
            prompt: 'What would you like the AI to do?',
            placeHolder: 'Fix this code, add comments, optimize...'
        });

        if (!question) return;

        const currentFile = editor.document.fileName;
        const terminal = vscode.window.createTerminal('Deep Insight');
        terminal.show();
        terminal.sendText(`deep-insight "${question}" "${currentFile}"`);
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
                    // Store relative path for better display
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