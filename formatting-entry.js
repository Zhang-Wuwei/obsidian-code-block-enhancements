import { fromMarkdown } from "mdast-util-from-markdown";
import * as prettier from "prettier/standalone";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import * as html from "prettier/plugins/html";
import * as postcss from "prettier/plugins/postcss";
import * as yaml from "prettier/plugins/yaml";
import * as graphql from "prettier/plugins/graphql";

const PARSERS = {
  js: "babel", javascript: "babel", jsx: "babel", mjs: "babel", cjs: "babel",
  ts: "typescript", typescript: "typescript", tsx: "typescript",
  html: "html", htm: "html", vue: "vue", css: "css", scss: "scss", less: "less",
  json: "json", jsonc: "jsonc", json5: "json5", yaml: "yaml", yml: "yaml", graphql: "graphql", gql: "graphql"
};
export const FORMAT_DEFAULTS = { printWidth: 100, tabWidth: 2, useTabs: false, semi: true, singleQuote: false,
  trailingComma: "all", arrowParens: "always", singleAttributePerLine: false,
  bracketSpacing: true, quoteProps: "as-needed", jsxSingleQuote: false, objectWrap: "preserve",
  bracketSameLine: false, vueIndentScriptAndStyle: false, htmlWhitespaceSensitivity: "css" };
const plugins = [babel, estree, typescript, html, postcss, yaml, graphql];

function parseMarkdown(source) {
  const bom = source.charCodeAt(0) === 0xfeff;
  let text = bom ? source.slice(1) : source;
  // Obsidian 的 YAML 属性不是 Markdown 正文；等长遮蔽可避免属性字符串中的围栏吞掉正文范围。
  const metadata = /^---[\t ]*\r?\n(?:[\s\S]*?\r?\n)?---[\t ]*(?:\r?\n|$)/.exec(text);
  if (metadata) text = metadata[0].replace(/[^\r\n]/g, " ") + text.slice(metadata[0].length);
  const root = fromMarkdown(text);
  // Markdown 解析器会忽略 BOM；源码偏移必须仍指向原始字符串，不能吞掉这个字节标记。
  if (bom) {
    const restoreOffsets = node => {
      if (node.position) { node.position.start.offset++; node.position.end.offset++; }
      for (const child of node.children || []) restoreOffsets(child);
    };
    restoreOffsets(root);
  }
  return root;
}

// 与格式化共用 Markdown AST，只计算显示范围，不改写源码。
export function markdownFoldRanges(source) {
  const ranges = [];
  const trimEnd = end => { while (end > 0 && /\s/.test(source[end - 1])) end--; return end; };
  const lineEnd = start => { const end = source.indexOf("\n", start); return end < 0 ? source.length : source[end - 1] === "\r" ? end - 1 : end; };
  const visit = node => {
    const children = node.children || [];
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child.type === "heading") {
        let end = node.position.end.offset;
        for (let next = index + 1; next < children.length; next++) {
          if (children[next].type === "heading" && children[next].depth <= child.depth) { end = children[next].position.start.offset; break; }
        }
        ranges.push({ from: child.position.end.offset, to: trimEnd(end) });
      } else if (["list", "listItem", "blockquote", "code", "html"].includes(child.type)) {
        const from = lineEnd(child.position.start.offset);
        let to = trimEnd(child.position.end.offset);
        const opening = child.type === "code" && /^ {0,3}(`{3,}|~{3,})/.exec(source.slice(child.position.start.offset, from));
        if (opening) {
          const lastLine = source.lastIndexOf("\n", to - 1) + 1;
          const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(source.slice(lastLine, to));
          if (closing && closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length) to = Math.max(from, lastLine - (source[lastLine - 2] === "\r" ? 2 : 1));
        }
        ranges.push({ from, to });
      }
      visit(child);
    }
  };
  visit(parseMarkdown(source));
  return ranges;
}

// 只保留两个精确源码快照，不保留整棵 AST；显示定位和格式化复用同一份结果。
const fenceSnapshots = new Map();
export function clearFenceSnapshots() { fenceSnapshots.clear(); }
export function findCodeBlocks(source) {
  if (fenceSnapshots.has(source)) return fenceSnapshots.get(source);
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  const lineText = index => source.slice(starts[index], starts[index + 1] ?? source.length).replace(/\r?\n$/, "");
  const blocks = [];
  const visit = (node, quotes = []) => {
    if (node.type === "blockquote") quotes = [...quotes, {
      from: node.position.start.offset, to: node.position.end.offset, line: node.position.start.line
    }];
    if (node.type === "code") {
      const opening = source.slice(node.position.start.offset, starts[node.position.start.line] ?? source.length).replace(/\r?\n$/, "");
      const fence = /^(`{3,}|~{3,})(.*)$/.exec(opening);
      if (!fence) return;
      const endIndex = node.position.end.line - 1;
      const closing = /^([\s>]*?)(`{3,}|~{3,})[\t ]*$/.exec(lineText(endIndex));
      const closed = endIndex > node.position.start.line - 1 && !!closing && closing[2][0] === fence[1][0] && closing[2].length >= fence[1].length;
      const value = node.value.replace(/\r\n/g, "\n");
      let prefix = closed ? closing[1] : "";
      // 闭合围栏可额外缩进；重建正文时沿用现有正文的容器前缀，而非闭合行缩进。
      for (const [index, valueLine] of value.split("\n").entries()) {
        if (!valueLine) continue;
        const raw = lineText(node.position.start.line + index);
        if (raw.endsWith(valueLine)) {
          const candidate = raw.slice(0, raw.length - valueLine.length);
          if (/^[\s>]*$/.test(candidate)) { prefix = candidate; break; }
        }
      }
      // 引用符后的一个空格属于 Markdown 容器语法，不能吞掉格式化器生成的首个缩进空格。
      if (prefix.endsWith(">")) prefix += " ";
      blocks.push({
        from: node.position.start.offset, to: node.position.end.offset,
        bodyFrom: starts[node.position.start.line] ?? source.length,
        bodyTo: closed ? starts[endIndex] : source.length,
        prefix, marker: fence[1], closed,
        language: (node.lang || "").toLowerCase(), meta: node.meta || "", value,
        line: node.position.start.line, quoteRanges: quotes,
        eol: source.slice(starts[node.position.start.line - 1], starts[node.position.start.line]).endsWith("\r\n") ? "\r\n" : "\n"
      });
    }
    for (const child of node.children || []) visit(child, quotes);
  };
  visit(parseMarkdown(source));
  for (const block of blocks) {
    for (const range of block.quoteRanges) Object.freeze(range);
    Object.freeze(block.quoteRanges);
    Object.freeze(block);
  }
  Object.freeze(blocks);
  if (source.length <= 2000000) {
    if (fenceSnapshots.size >= 2) fenceSnapshots.delete(fenceSnapshots.keys().next().value);
    fenceSnapshots.set(source, blocks);
  }
  return blocks;
}

export function applyChanges(source, changes) {
  let result = source;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, change.from) + change.text + result.slice(change.to);
  }
  return result;
}

export function locateCodeBlock(source, line, expectedText, snapshot) {
  if (source.length > 2000000 || (snapshot?.length || 0) > 2000000) throw new Error("笔记过大，已取消格式化。");
  const current = findCodeBlocks(source);
  let block = current.find(b => b.line === line + 1);
  if (snapshot !== undefined && snapshot !== source) {
    const previous = findCodeBlocks(snapshot);
    const index = previous.findIndex(b => b.line === line + 1);
    // 只允许其他围栏内部内容变化引起的位移，不凭相同代码片段或行号猜位置。
    const skeleton = (text, blocks) => applyChanges(text, blocks.map(b => ({ from: b.bodyFrom, to: b.bodyTo, text: "" })));
    if (index < 0 || current.length !== previous.length || previous.some(b => !b.closed) || current.some(b => !b.closed) ||
      skeleton(source, current) !== skeleton(snapshot, previous)) throw new Error("笔记结构已变化，请刷新显示后重试。");
    block = current[index];
  }
  if (!block) throw new Error("代码块位置已变化，请刷新显示后重试。");
  if (expectedText !== undefined && block.value !== expectedText.replace(/\r\n/g, "\n").replace(/\n$/, "")) {
    throw new Error("代码块显示已过期，请刷新后重试；未修改源码。");
  }
  return block;
}

export { formatClang } from "./extra-formatters-entry.js";
import { formatJava } from "./extra-formatters-entry.js";

export async function planFormatting(source, selections, preferences = {}) {
  if (source.length > 2000000) throw new Error("笔记过大（超过 200 万字符），请先拆分后重试。");
  const blocks = findCodeBlocks(source);
  const targets = new Set();
  for (const selection of selections) {
    const from = Math.min(selection.from, selection.to), to = Math.max(selection.from, selection.to);
    const containing = blocks.find(b => from >= b.from && to <= b.to);
    if (containing) { targets.add(containing); continue; }
    const overlaps = blocks.filter(b => from < b.to && to > b.from);
    if (!overlaps.length) throw new Error("请将光标放入围栏代码块，或选择完整代码块。");
    if (overlaps.some(b => from > b.from || to < b.to)) throw new Error("跨代码块选择时，请完整选中各代码块；不会格式化不完整的跨块选区。");
    overlaps.forEach(b => targets.add(b));
  }
  if (!targets.size) throw new Error("未找到要格式化的围栏代码块。");
  // 所有代码块先生成结果并复核，调用方最后以单次事务提交，避免部分成功。
  const changes = [], expected = new Map();
  for (const block of [...targets].sort((a, b) => a.from - b.from)) {
    const label = `第 ${block.line} 行的 ${block.language || "未标记语言"} 代码块`;
    if (!block.closed) throw new Error(`${label}没有闭合围栏，已取消。`);
    const parser = PARSERS[block.language];
    const managed = ["python", "py", "c", "cpp", "c++", "cxx", "cc"].includes(block.language);
    if (!parser && !managed && block.language !== "java") throw new Error(`${label}不支持格式化，未修改任何代码块。`);
    if (block.value.length > 200000) throw new Error(`${label}过大（超过 20 万字符），已取消。`);
    let formatted;
    if (managed) {
      if (!preferences.formatManaged) throw new Error("此语言需要插件的格式化组件运行环境，原代码未修改。");
      formatted = await preferences.formatManaged(block.value, block.language);
    } else try {
      const options = {
        ...FORMAT_DEFAULTS,
        printWidth: preferences.printWidth ?? FORMAT_DEFAULTS.printWidth,
        tabWidth: preferences.tabWidth ?? FORMAT_DEFAULTS.tabWidth,
        useTabs: !!preferences.useTabs, semi: preferences.semi ?? true, singleQuote: !!preferences.singleQuote,
        trailingComma: ["none", "es5", "all"].includes(preferences.trailingComma) ? preferences.trailingComma : FORMAT_DEFAULTS.trailingComma,
        arrowParens: preferences.arrowParens === "avoid" ? "avoid" : "always",
        singleAttributePerLine: preferences.singleAttributePerLine === true,
        bracketSpacing: preferences.bracketSpacing !== false,
        quoteProps: ["as-needed", "consistent", "preserve"].includes(preferences.quoteProps) ? preferences.quoteProps : "as-needed",
        jsxSingleQuote: preferences.jsxSingleQuote === true,
        objectWrap: preferences.objectWrap === "collapse" ? "collapse" : "preserve",
        bracketSameLine: preferences.bracketSameLine === true,
        vueIndentScriptAndStyle: preferences.vueIndentScriptAndStyle === true,
        htmlWhitespaceSensitivity: ["css", "strict", "ignore"].includes(preferences.htmlWhitespaceSensitivity) ? preferences.htmlWhitespaceSensitivity : "css",
        parser, plugins, embeddedLanguageFormatting: preferences.embeddedLanguageFormatting === true ? "auto" : "off", endOfLine: "lf"
      };
      formatted = block.language === "java" ? await formatJava(block.value, options) : await prettier.format(block.value, options);
    } catch (error) {
      const location = error.loc?.start || error.loc;
      const row = location?.line;
      const column = location?.column;
      const position = Number.isInteger(row) ? `代码块第 ${row} 行${Number.isInteger(column) ? `、第 ${column} 列` : ""}附近` : "代码块中";
      const reason = String(error.message || "").split("\n")[0];
      if (!Number.isInteger(row) && !/^(?:Failed to parse:|Unexpected|Unterminated|Unclosed)/i.test(reason)) {
        throw new Error("格式化器内部异常，未能完成格式化；这不代表代码有语法错误。原代码未修改。");
      }
      let description = "存在语法错误，请检查附近的标点和语法结构";
      if (/Unexpected token/i.test(reason)) {
        const text = block.value.split(/\r?\n/)[(row || 1) - 1] || "";
        description = Number.isInteger(column) && /=\s*;$/.test(text.slice(0, column)) ? "等号后缺少要赋的值，请补全表达式" : "出现不符合语法的符号，或缺少必要的表达式";
      }
      else if (/Unterminated.*string|Unclosed.*string/i.test(reason)) description = "字符串没有正确结束，请检查引号";
      else if (/Unclosed.*block|Unexpected.*end|Unterminated.*template/i.test(reason)) description = "代码可能没有写完整，请检查括号、引号或结束标记";
      else if (block.language.startsWith("json")) description = "JSON 写法不正确，请检查逗号、引号和键值分隔符";
      throw new Error(`${position}${description}。原代码未修改。`);
    }
    if (typeof formatted !== "string" || formatted.length > 1000000) throw new Error("格式化结果无效或过大，原代码未修改。");
    const value = formatted.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const closingPattern = new RegExp(`^ {0,3}${block.marker[0] === "`" ? "`" : "~"}{${block.marker.length},}[\\t ]*$`, "m");
    if (closingPattern.test(value)) throw new Error(`${label}的格式化结果包含闭合围栏，已取消。`);
    const text = value ? value.split("\n").map(line => block.prefix + line).join(block.eol) + block.eol : "";
    if (source.slice(block.bodyFrom, block.bodyTo) !== text) changes.push({ from: block.bodyFrom, to: block.bodyTo, text });
    expected.set(blocks.indexOf(block), value);
  }
  const updated = findCodeBlocks(applyChanges(source, changes));
  if (updated.length !== blocks.length || updated.some((block, index) => {
    const before = blocks[index];
    return block.language !== before.language || block.meta !== before.meta || block.closed !== before.closed ||
      block.value !== (expected.has(index) ? expected.get(index) : before.value);
  })) throw new Error("格式化结果未通过 Markdown 围栏边界检查，未修改任何内容。");
  return { changes, blocks: targets.size };
}
