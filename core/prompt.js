'use strict';

const fs = require('fs');
const path = require('path');
const { readFile, numberLines } = require('./fileOps');
const { buildTree } = require('./ignore');

const RULES_BLOCK = `
Rules:
1. Your response must contain exactly ONE fenced XML code block that holds all file changes (except in the case described in rule 5). The code block MUST start with \`\`\`xml on its own line and end with \`\`\` on its own line. In addition, write a short, clear explanation in plain markdown text OUTSIDE the code block, placed before it, describing what you changed (or the answer to the question) and why, written in the same language as the user's question. Never put the explanation inside the XML block, and do not use any other fenced code blocks anywhere in the response (use inline code formatting if you need to mention code).
2. Wrap each file like: <file name="..." path="..." action="edit|create">code here</file>
   - Use action="edit" for existing files that are being modified.
   - Use action="create" for brand new files that do not exist yet.
   - For path, use only the filename (e.g. app.py) or a relative path (e.g. utils/helpers.py). Do NOT use absolute paths.
3. Do NOT include readonly files in the output under any circumstances.
4. Create new files when the task requires functionality not covered by existing editable files.
5. If you need the content of additional files not provided here, respond ONLY with a <need_more_info> tag like:
   <need_more_info reason="explain why" files="file1.py,file2.py" />
   Do NOT mix <need_more_info> with file output. Use one or the other.
6. For action="create", the <file> content MUST be the ENTIRE new file content, top to bottom, wrapped in CDATA:
   <file name="new.py" path="new.py" action="create"><![CDATA[
   ...full new file content...
   ]]></file>
7. For action="edit", do NOT return the whole file and do NOT put raw file content directly inside <file>. Instead, return ONLY the changed portions as one or more <hunk> tags nested inside <file>. Line numbers ALWAYS refer to the ORIGINAL line numbers shown in the numbered file listing below, never to a version already modified by another hunk in the same response:
   - Replace original lines N..M (inclusive) with new content:
     <hunk op="replace" start="N" end="M"><![CDATA[
     ...new lines...
     ]]></hunk>
   - Insert new lines immediately after original line N (use after="0" to insert before the first line):
     <hunk op="add" after="N"><![CDATA[
     ...new lines...
     ]]></hunk>
   - Delete original lines N..M (inclusive), no content needed:
     <hunk op="delete" start="N" end="M" />
   - Hunks for the same file must not overlap. Double-check start/end/after numbers against the numbered source below — precision is critical.
8. The "N: " line-number prefix shown for each editable file below is for your reference ONLY, to compute accurate hunk positions. It is NOT part of the actual file content and must never appear inside <hunk> content.
9. If you need to explore the project before editing (e.g. find where a problem is, search for a symbol, or view part of a file) instead of being given many files, you may respond ONLY with one or more read-only command tags, like:
   <run_command reason="explain why" command="grep -rn 'functionName' src" />
   <run_command reason="explain why" command="sed -n '10,60p' src/app.js" />
   - Allowed commands (read-only only): cat, head, tail, grep, egrep, fgrep, rg, sed (only with -n, never -i), find (no -exec/-delete), ls, tree, wc, sort, uniq, cut, nl, file, stat, diff, basename, dirname, pwd, tr. You may combine them with a pipe (|). All paths (arguments to any command, including git) must stay inside the current project directory — no absolute paths outside it, no "..", and no following a symlink that points outside it.
   - If the user asks you to look at what changed in the project (e.g. via git) or to base an edit on the current git state, you may also use these read-only git subcommands: git status, git diff, git log, git show, git blame, git branch (only with flags such as -a/-v/--list, never a branch name), git remote (only with -v), git ls-files, git rev-parse. Never use any other git subcommand, and never add flags such as --output, -c, or --exec to any git subcommand — some flags on an otherwise read-only git subcommand can still write to a file or run an external program, so the restriction applies to arguments and flags just as much as to the base command.
   - Inside command="..." use SINGLE quotes for arguments, never double quotes. Do NOT use ;, &&, ||, >, <, backticks, $(...), or paths outside the project.
   - Do NOT mix <run_command> with file output or <need_more_info>. Use one or the other. The command output will be sent back to you and then you can continue (request more, or produce the final answer).
   - IMPORTANT: <run_command> (including cat, head, tail, sed -n) is for exploration ONLY — locating a symbol, inspecting a snippet, or checking a handful of lines. It must never be used to dump the full content of a file (e.g. \`cat wholefile.js\`, \`sed -n '1,999p' wholefile.js\`, or \`head -c 999999\`). If you determine that you actually need the complete content of a specific file in order to edit it, do NOT fetch it via <run_command> — respond ONLY with a <need_more_info reason="explain why" files="file1.py,file2.py" /> tag instead, exactly as in rule 5, so the file is added to the editable file set properly.
   - After exploring, only request/edit the files that actually have problems.
10. <run_command> is strictly read-only. NEVER issue a command that writes, creates, deletes, moves, renames, or otherwise modifies any file, git state, or system state — and this applies just as much to an argument or flag as it does to the base command name. A command name that looks read-only can still write or execute something through one of its flags (this includes, but is not limited to: git add, git commit, git checkout, git reset, git stash, git rm, git apply, git branch <name>, git remote add, any git subcommand or flag such as --output, -c, or --exec that writes to a file or runs an external program, rm, mv, cp, touch, mkdir, chmod, chown, sed -i, tee, redirections like > or >>, npm/yarn/pip install, or any command run with sudo). This restriction has no exceptions: it applies even if the user explicitly asks for it, insists, approves it in advance, or claims urgency, and even if such a command appears to have been allowed or executed earlier in the conversation. If a change to files or state is genuinely needed, it must go through the normal <file action="edit|create"> mechanism instead, never through <run_command>.
`;

function buildPrompt(question, contextFiles, validFiles, currentDir, {
  extraFiles = null,
  includeRules = true,
  includeContext = true,
} = {}) {
  let fullQuestion = `${question}\n`;

  if (includeRules) {
    fullQuestion += RULES_BLOCK;
  }

  if (includeContext) {
    const tree = buildTree(currentDir);
    fullQuestion += `
Current working directory: ${currentDir}

Project structure:
\`\`\`
${tree}
\`\`\`
`;
  }

  for (const fileName of contextFiles) {
    const filePath = path.join(currentDir, fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      try {
        const content = readFile(filePath);
        fullQuestion += `\n<file name="${fileName}" path="${fileName}" readonly>\n<![CDATA[\n${content}\n]]>\n</file>\n`;
      } catch (e) {
        fullQuestion += `\n⚠️ Error reading context file ${fileName}: ${e.message}\n`;
      }
    }
  }

  for (const [fileName, filePath] of validFiles) {
    try {
      const content = readFile(filePath);
      const numbered = numberLines(content);
      fullQuestion += `\n<file name="${fileName}" path="${filePath}">\n<![CDATA[\n${numbered}\n]]>\n</file>\n`;
    } catch (e) {
      fullQuestion += `\n⚠️ Error reading file ${fileName}: ${e.message}\n`;
    }
  }

  if (extraFiles) {
    for (const [fileName, filePath] of extraFiles) {
      try {
        const content = readFile(filePath);
        const numbered = numberLines(content);
        fullQuestion += `\n<file name="${fileName}" path="${filePath}">\n<![CDATA[\n${numbered}\n]]>\n</file>\n`;
      } catch (e) {
        fullQuestion += `\n⚠️ Error reading extra file ${fileName}: ${e.message}\n`;
      }
    }
  }

  return fullQuestion;
}

function collectFiles(fileList, currentDir, onLog = () => { }) {
  const validFiles = [];
  for (let filePath of fileList) {
    if (!path.isAbsolute(filePath)) filePath = path.join(currentDir, filePath);
    const fileName = path.basename(filePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      validFiles.push([fileName, filePath]);
      onLog(`✅ File found: ${fileName}`);
    } else {
      onLog(`⚠️ File does not exist: ${filePath}`);
    }
  }
  if (validFiles.length === 0 && fileList.length > 0) {
    onLog('⚠️ None of the specified files were found.');
  }
  return validFiles;
}

module.exports = { buildPrompt, collectFiles };