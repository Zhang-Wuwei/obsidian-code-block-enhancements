"use strict";
const parsers = {
  java: require("@lezer/java").parser,
  javascript: require("@lezer/javascript").parser,
  python: require("@lezer/python").parser,
  html: require("@lezer/html").parser,
  css: require("@lezer/css").parser,
  json: require("@lezer/json").parser,
  cpp: require("@lezer/cpp").parser,
  go: require("@lezer/go").parser,
  rust: require("@lezer/rust").parser,
  yaml: require("@lezer/yaml").parser,
  scss: require("@lezer/sass").parser,
  less: require("@codemirror/lang-less").lessLanguage.parser,
  xml: require("@lezer/xml").parser,
  sql: require("@codemirror/lang-sql").StandardSQL.language.parser,
  php: require("@lezer/php").parser
};
parsers.typescript = parsers.javascript.configure({ dialect: "ts" });
parsers.jsx = parsers.javascript.configure({ dialect: "jsx" });
parsers.tsx = parsers.javascript.configure({ dialect: "ts jsx" });
const aliases = { js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", py: "python", htm: "html", jsonc: "json", c: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp", golang: "go", rs: "rust" };

// 没有语言提供者时，按缩进层级折叠；不猜括号，也不声称识别语法。
function indentationRegions(text, tabSize) {
  tabSize = Number.isInteger(tabSize) && tabSize > 0 ? tabSize : 4;
  const stack = [], ranges = [];
  let previous, offset = 0, lineNumber = 0;
  const close = header => {
    if (!previous || previous.line <= header.line) return;
    ranges.push({ from: header.end, to: previous.end, startLine: header.line, endLine: previous.line,
      startColumn: header.length, endColumn: previous.length });
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim()) {
      let indent = 0;
      for (const character of line) {
        if (character === " ") indent++;
        else if (character === "\t") indent += tabSize - indent % tabSize;
        else break;
      }
      while (stack.length && indent <= stack[stack.length - 1].indent) close(stack.pop());
      if (previous && indent > previous.indent) stack.push(previous);
      previous = { indent, line: lineNumber, length: line.length, end: offset + line.length };
    }
    offset += raw.length + 1;
    lineNumber++;
  }
  while (stack.length) close(stack.pop());
  return ranges.sort((a, b) => a.from - b.from);
}

// 已有语言提供者时只使用解析树结构，不用缩进覆盖字符串/注释的语法边界。
function foldRegions(text, language, tabSize = 4) {
  language = (language || "").toLowerCase();
  language = ({ yml: "yaml", md: "markdown" })[language] || aliases[language] || language;
  let parser = parsers[language];
  if (!parser && language !== "markdown") return indentationRegions(text, tabSize);
  if (language === "php") {
    const plain = parser.configure({ top: "Program" });
    const markers = [...text.matchAll(/<\?(?:php\b|=)/gi)];
    let tagged = markers.length > 0;
    // 纯 PHP 字符串或注释里的起始标签不切换模板模式。
    if (tagged && !text.trimStart().startsWith("<")) {
      const literals = [];
      plain.parse(text).iterate({ enter(ref) {
        if (["String", "HeredocString", "BlockComment", "LineComment"].includes(ref.name)) {
          literals.push([ref.from, ref.to]); return false;
        }
      } });
      tagged = markers.some(marker => !literals.some(([from, to]) => marker.index >= from && marker.index < to));
    }
    parser = tagged ? parser : plain;
  }
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineAt = position => {
    let low = 0, high = starts.length;
    while (low + 1 < high) { const middle = (low + high) >> 1; if (starts[middle] <= position) low = middle; else high = middle; }
    return low;
  };
  const ranges = new Map();
  const lineEnd = position => { const end = text.indexOf("\n", position); return end < 0 ? text.length : text[end - 1] === "\r" ? end - 1 : end; };
  const trimEnd = position => { while (position > 0 && /\s/.test(text[position - 1])) position--; return position; };
  const add = (from, to) => {
    if (from === undefined || to <= from) return;
    const startLine = lineAt(from), endLine = lineAt(to);
    if (endLine <= startLine) return;
    const range = { from, to, startLine, endLine, startColumn: from - starts[startLine], endColumn: to - starts[endLine] };
    const old = ranges.get(startLine);
    if (!old || old.to < to) ranges.set(startLine, range);
  };
  if (language === "markdown") {
    for (const range of require("./formatting.js").markdownFoldRanges(text)) add(range.from, range.to);
    return Array.from(ranges.values()).sort((a, b) => a.from - b.from);
  }
  const tree = parser.parse(text);
  tree.iterate({ enter(ref) {
    const node = ref.node;
    if (["scss", "less", "sql", "php"].includes(language) && ["BlockComment", "Comment"].includes(node.name) && text.slice(node.from, node.from + 2) === "/*") {
      add(node.from + 2, text.slice(node.to - 2, node.to) === "*/" ? node.to - 2 : node.to);
      return false;
    }
    if (language === "xml" && node.name === "Comment") { add(node.from + 4, node.to - 3); return false; }
    if (["String", "HeredocString", "BlockLiteralContent", "Cdata"].includes(node.name)) return false;
    const first = node.firstChild, last = node.lastChild;
    if (!first || !last) return;
    let from, to;
    const pairs = { "{": "}", "[": "]", "(": ")" };
    if (pairs[first.name] === last.name) { from = first.to; to = last.from; }
    else if (node.name === "JSXElement" && first.name === "JSXOpenTag" && last.name === "JSXCloseTag") {
      from = first.to; to = last.from;
    }
    else if (language === "python" || language === "py") {
      if (node.name === "Body" && first.name === ":") { from = first.to; to = node.to; }
    } else if ((language === "html" || language === "xml") && node.name === "Element" && first.name === "OpenTag" && last.name === "CloseTag") {
      from = first.to; to = last.from;
    }
    if (language === "yaml" && ["Pair", "Item", "BlockLiteral"].includes(node.name)) { from = lineEnd(node.from); to = trimEnd(node.to); }
    if (language === "sql" && node.name === "Statement") { from = lineEnd(node.from); to = trimEnd(node.to); }
    if (language === "php" && node.name === "ColonBlock") { from = node.from + 1; to = trimEnd(node.to); }
    add(from, to);
  } });
  return Array.from(ranges.values()).sort((a, b) => a.from - b.from);
}
module.exports = { foldRegions };
