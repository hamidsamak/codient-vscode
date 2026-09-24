'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ALLOWED_COMMANDS = new Set([
  'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'sed', 'find',
  'ls', 'tree', 'wc', 'sort', 'uniq', 'cut', 'nl', 'file', 'stat',
  'diff', 'basename', 'dirname', 'pwd', 'tr', 'git',
]);

const GIT_ALLOWED_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'branch', 'remote', 'ls-files', 'rev-parse',
]);

const GIT_FLAGS_ONLY_SUBCOMMANDS = new Set(['branch', 'remote']);

const FORBIDDEN_FIND_ARGS = new Set([
  '-exec', '-execdir', '-ok', '-okdir', '-delete',
  '-fprint', '-fprint0', '-fprintf', '-fls',
]);

const MAX_COMMANDS_PER_ROUND = 10;
const MAX_OUTPUT_CHARS = 20000;
const TIMEOUT_MS = 15000;

const FORBIDDEN_UNQUOTED = new Set([';', '&', '<', '>', '`', '$', '(', ')', '\n', '\r', '\\']);
const FORBIDDEN_DOUBLE_QUOTED = new Set(['$', '`', '\\']);

function unescapeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

}

// Splits a command line into pipeline segments, each an array of tokens.
// Throws an Error if forbidden shell syntax is found.
function parsePipeline(cmd) {
  const segments = [];
  let tokens = [];
  let cur = '';
  let hasToken = false;
  let quoted = false;
  let state = 'none'; // none | single | double

  const pushToken = () => {
    if (hasToken) tokens.push({ text: cur, quoted });
    cur = '';
    hasToken = false;
    quoted = false;
  };

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    if (state === 'single') {
      if (ch === "'") state = 'none';
      else cur += ch;
      continue;
    }

    if (state === 'double') {
      if (ch === '"') { state = 'none'; continue; }
      if (FORBIDDEN_DOUBLE_QUOTED.has(ch)) throw new Error(`character "${ch}" is not allowed inside double quotes (use single quotes)`);
      cur += ch;

      continue;
    }

    // state === 'none'
    if (ch === "'") { state = 'single'; hasToken = true; quoted = true; continue; }
    if (ch === '"') { state = 'double'; hasToken = true; quoted = true; continue; }
    if (ch === '|') {
      if (cmd[i + 1] === '|') throw new Error('"||" is not allowed');
      pushToken();
      if (tokens.length === 0) throw new Error('empty command in pipeline');
      segments.push(tokens);
      tokens = [];
      continue;
    }
    if (FORBIDDEN_UNQUOTED.has(ch)) throw new Error(`character "${ch === '\n' ? '\\n' : ch}" is not allowed outside quotes`);
    if (/\s/.test(ch)) { pushToken(); continue; }
    cur += ch;
    hasToken = true;
  }

  if (state !== 'none') throw new Error('unterminated quote');
  pushToken();
  if (tokens.length === 0) throw new Error('empty command');
  segments.push(tokens);
  return segments;
}

function checkPathToken(text, cwd) {
  if (text.startsWith('~')) throw new Error(`path "${text}" is not allowed`);
  if (/(^|[\/\\])\.\.([\/\\]|$)/.test(text)) throw new Error(`path "${text}" goes outside the project`);
  if (path.isAbsolute(text)) {
    const resolved = path.resolve(text);

    const root = path.resolve(cwd);
    const inside = resolved === root || resolved.startsWith(root + path.sep);
    if (!inside && fs.existsSync(resolved)) throw new Error(`path "${text}" is outside the project`);
  }
}

function validateSegment(tokens, cwd) {
  const name = tokens[0].text;
  if (!ALLOWED_COMMANDS.has(name)) throw new Error(`command "${name}" is not in the read-only allowlist`);

  const args = tokens.slice(1);

  for (const t of args) checkPathToken(t.text, cwd);

  if (name === 'find') {
    for (const t of args) {
      if (FORBIDDEN_FIND_ARGS.has(t.text)) throw new Error(`find option "${t.text}" is not allowed`);
    }
  }

  if (name === 'sed') {
    let hasN = false;
    for (const t of args) {
      const a = t.text;
      if (!t.quoted && a.startsWith('-')) {
        if (a === '--in-place' || a.startsWith('--in-place=')) throw new Error('sed in-place editing is not allowed');
        if (!a.startsWith('--') && /^-[a-zA-Z]*i/.test(a)) throw new Error('sed -i is not allowed');
        if (a === '-n' || a === '--quiet' || a === '--silent' || (!a.startsWith('--') && /^-[a-zA-Z]*n/.test(a))) hasN = true;
      }
      if (/(^|[;{}\n\d,$\/])\s*[weWE](\s|$)/.test(a)) throw new Error('sed w/e commands are not allowed');
    }
    if (!hasN) throw new Error('sed is only allowed with -n (e.g. sed -n \'10,40p\' file)');

  }

  if (name === 'git') {
    if (args.length === 0) throw new Error('git requires a read-only subcommand (e.g. status, diff, log)');
    const sub = args[0].text;
    if (!GIT_ALLOWED_SUBCOMMANDS.has(sub)) throw new Error(`git subcommand "${sub}" is not in the read-only allowlist`);
    if (GIT_FLAGS_ONLY_SUBCOMMANDS.has(sub)) {
      for (const t of args.slice(1)) {
        if (!t.text.startsWith('-')) {
          throw new Error(`git ${sub} with argument "${t.text}" is not allowed (only flags like -v/-a are permitted, since a positional argument here can create or modify state)`);
        }
      }
    }
  }
}

function validateCommand(cmd, cwd) {
  const segments = parsePipeline(cmd);
  for (const seg of segments) validateSegment(seg, cwd);
}

function runShell(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      let code = 0;
      if (err) code = typeof err.code === 'number' ? err.code : (err.killed ? 'timeout' : 1);
      resolve({ code, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + `\n... [output truncated: ${text.length - MAX_OUTPUT_CHARS} more characters]`;
}

async function executeCommands(commands, cwd, { onLog = () => { } } = {}) {
  const results = [];
  const list = commands.slice(0, MAX_COMMANDS_PER_ROUND);

  if (commands.length > MAX_COMMANDS_PER_ROUND) {
    onLog(`   ⚠️ Too many commands, only the first ${MAX_COMMANDS_PER_ROUND} will run`);
  }

  for (const item of list) {

    const command = unescapeEntities(item.command).trim();
    onLog(`   $ ${command}`);

    try {
      validateCommand(command, cwd);
    } catch (e) {
      onLog(`   ❌ Rejected: ${e.message}`);
      results.push({ command, text: `$ ${command}\n[REJECTED] ${e.message}\n` });
      continue;
    }

    const { code, stdout, stderr } = await runShell(command, cwd);
    let text = `$ ${command}\n[exit code: ${code}]\n`;
    if (stdout) text += `${truncate(stdout)}\n`;
    else text += '(no output)\n';
    if (stderr) text += `[stderr]\n${truncate(stderr)}\n`;
    onLog(`   ✅ Done (exit ${code}, ${stdout.length} chars)`);
    results.push({ command, text });
  }

  return results;
}

module.exports = { executeCommands, validateCommand };