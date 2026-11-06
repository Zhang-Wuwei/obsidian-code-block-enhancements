"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = fs.realpathSync(__dirname);
const vault = path.join(root, "test-vault");
const plugin = path.join(vault, ".obsidian", "plugins", "code-block-enhancements");

function safeWrite(relative, bytes) {
  const target = path.resolve(vault, relative);
  if (!target.startsWith(vault + path.sep)) throw new Error("Target escapes test vault.");
  // Never follow a junction or symlink out of the disposable test vault.
  for (let current = target; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked test path refused: ${current}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

if (process.argv[2] === "reset") {
  for (const name of fs.readdirSync(path.join(root, "test-fixtures"))) {
    if (name.endsWith(".md")) safeWrite(name, fs.readFileSync(path.join(root, "test-fixtures", name)));
  }
  safeWrite(".obsidian/app.json", JSON.stringify({ livePreview: true, showLineNumber: true, readableLineLength: true }, null, 2));
  safeWrite(".obsidian/appearance.json", JSON.stringify({ theme: "moonstone", baseFontSize: 18, monospaceFontFamily: "JetBrains Mono NL,Consolas" }, null, 2));
  safeWrite(".obsidian/community-plugins.json", '["code-block-enhancements"]\n');
  safeWrite(".obsidian/core-plugins.json", '["file-explorer","outline","switcher","command-palette"]\n');
  safeWrite(".obsidian/plugins/code-block-enhancements/manifest.json", fs.readFileSync(path.join(root, "manifest.json")));
  safeWrite(".obsidian/plugins/code-block-enhancements/data.json", JSON.stringify({ wrap: true, folding: true, formatWidth: 100, formatTabWidth: 2, formatSemi: true, formatSingleQuote: false, formatEmbedded: true, formatTrailingComma: "none", formatArrowParens: "always", formatSingleAttributePerLine: false }, null, 2));
} else if (process.argv[2] === "install") {
  const { RELEASE_FILES } = require("./release.cjs");
  if (!fs.existsSync(plugin)) throw new Error("Run test:vault:reset first.");
  for (const name of RELEASE_FILES) safeWrite(path.join(".obsidian", "plugins", "code-block-enhancements", name), fs.readFileSync(path.join(root, name)));
} else if (process.argv[2] === "stress") {
  safeWrite("90 大代码块.md", "# 90 大代码块\n\n```js\n" + "// boundary test\n".repeat(14000) + "```\n");
  safeWrite("91 大笔记.md", "# 91 大笔记\n\n" + "paragraph for size limit\n\n".repeat(85000) + "```js\nconst x={a:1};\n```\n");
} else {
  throw new Error("Use reset, install or stress. Commands only write inside test-vault.");
}
console.log(vault);
