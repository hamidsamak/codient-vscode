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
- 👤 Multi-profile Chrome support (separate sessions per account)

---

## 🚀 Commands

Open the Command Palette:

- Windows/Linux: `Ctrl + Shift + P`
- Mac: `Cmd + Shift + P`

Then use one of the following commands:

---

### Codient: Ask AI

Analyze and edit files using AI — applies changes directly with automatic backup.

Use this for:
- Bug fixing
- Code review
- Optimization suggestions
- Adding comments or improvements

---

### Codient: Preview Changes

Same as Ask AI but without modifying files — generates a visual HTML diff report that opens automatically in your browser.

Use this for:
- Reviewing AI suggestions before applying
- Safe exploration of refactoring ideas

---

### Codient: Open Browser Session

Opens a persistent AI web session in Chrome using the **currently active profile** (set via Settings or `Codient: Switch Profile`).

Use this for:
- Logging in to AI accounts
- Manual AI interaction
- Login-based workflows

> To login with a different profile, first run `Codient: Switch Profile`, then open the browser session.

---

### Codient: Switch Profile

Interactively switch between Chrome profiles.

- Shows a list of all existing profiles from `~/.codient/profiles/`
- Lets you type a new profile name to create one on the fly
- Updates the `codient.profile` setting globally

Use this for:
- Switching between work and personal accounts
- Managing multiple AI accounts per model

---

## ⚙️ Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codient.model` | `default` | AI model to use: `claude`, `chatgpt`, `deepseek` |
| `codient.proxy` | `` | Proxy address (e.g. `http://127.0.0.1:8080`) |
| `codient.profile` | `default` | Chrome profile to use. Use `Codient: Switch Profile` to change interactively. |

---

## 👤 Profiles

Profiles let you maintain **separate Chrome sessions** for different accounts or purposes.

Each profile is stored under:

```
~/.codient/profiles/<name>/
```

**Typical workflow:**

```
1. Codient: Switch Profile → select "work"
2. Codient: Open Browser Session → login with work account
3. Codient: Ask AI → runs with work profile automatically
```

You can have as many profiles as you need — `default`, `work`, `personal`, `client-x`, etc.

---

## ⚙️ CLI Integration

This extension acts as a frontend for the Codient Python CLI engine.

Example usage:

```bash
codient "Fix this code" file1.py file2.py
codient --profile work --model claude "Refactor this" main.py
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