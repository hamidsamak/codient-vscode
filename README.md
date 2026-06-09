# Codient – AI Code Assistant for VSCode

Codient is a command-line driven Visual Studio Code extension that integrates **Claude, ChatGPT, and DeepSeek** (via the Codient CLI) to analyze, refactor, and generate code directly from your workspace.

It is designed for real-world development workflows, supporting multi-file analysis, context injection, rollback history, safe overwrite, and browser-based sessions.

---

## ✨ Features

- 🤖 Multi-model AI support (Claude, ChatGPT, DeepSeek) via Codient CLI
- 📂 Analyze single or multiple files
- 🧠 Composite mode for multi-file understanding
- 📌 Optional context file injection
- 💾 Safe overwrite mode with automatic backups
- 🔄 File history & rollback system
- 🌐 Browser session mode (persistent login)
- 📊 HTML diff report generation
- 🐛 Debug mode (prompt + response logging)
- 🌐 Proxy support (HTTP / SOCKS5)

---

## 🚀 Commands

Open the Command Palette:

- Windows/Linux: `Ctrl + Shift + P`
- Mac: `Cmd + Shift + P`

Then use one of the following commands:

---

### Codient: Ask AI (Current File)

Codient: Ask AI (Current File)

Analyze only the currently open file.

Use this for:
- Bug fixing
- Code review
- Optimization suggestions
- Adding comments or improvements

---

### Codient: Ask AI (Composite Mode - Multiple Files)

Codient: Ask AI (Composite Mode - Multiple Files)

Analyze multiple files together using AI.

Use this for:
- Cross-file refactoring
- Architecture review
- Multi-module debugging
- System-wide changes

---

### Codient: Open Browser Session

Codient: Open Browser Session

Opens a persistent AI web session in Chrome.

Use this for:
- Manual AI interaction
- Long conversations
- Login-based workflows
- Complex debugging sessions

---

## ⚙️ CLI Integration

This extension acts as a frontend for the Codient Python CLI engine.

Example usage:

```bash
codient "Fix this code" file1.py file2.py
```

---

## 🛠️ Build & Install

📦 Install VSCE (one time only)
```bash
npm install -g @vscode/vsce
```

🚀 Build Extension (.vsix package)
```bash
vsce package
```

📥 Install Locally in VSCode
```bash
code --install-extension codient-*.vsix
```
