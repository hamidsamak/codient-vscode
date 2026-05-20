# Deep Insight – DeepSeek AI Assistant for VSCode

Deep Insight is a command-line driven Visual Studio Code extension that integrates **DeepSeek AI** to analyze, refactor, and generate code directly from your workspace.

It is designed for real-world development workflows, supporting multi-file analysis, context injection, rollback history, safe overwrite, and browser-based sessions.

---

## ✨ Features

- 🤖 Powered by DeepSeek AI (via CLI + Selenium bridge)
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

### Deep Insight: Ask AI (Current File)

Deep Insight: Ask AI (Current File)

Analyze only the currently open file.

Use this for:
- Bug fixing
- Code review
- Optimization suggestions
- Adding comments or improvements

---

### Deep Insight: Ask AI (Composite Mode - Multiple Files)

Deep Insight: Ask AI (Composite Mode - Multiple Files)

Analyze multiple files together using DeepSeek AI.

Use this for:
- Cross-file refactoring
- Architecture review
- Multi-module debugging
- System-wide changes

---

### Deep Insight: Open Browser Session

Deep Insight: Open Browser Session

Opens a persistent DeepSeek web session in Chrome.

Use this for:
- Manual AI interaction
- Long conversations
- Login-based workflows
- Complex debugging sessions

---

## ⚙️ CLI Integration

This extension acts as a frontend for a Python CLI engine.

Example usage:

```bash
deep-insight "Fix this code" file1.py file2.py
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
code --install-extension deep-insight-1.0.0.vsix
```