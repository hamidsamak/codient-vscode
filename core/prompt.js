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

function collectFiles(fileList, currentDir, onLog = () => {}) {
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
