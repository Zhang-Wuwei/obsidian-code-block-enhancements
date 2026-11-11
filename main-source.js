"use strict";

const { Plugin, PluginSettingTab, Setting, MarkdownRenderChild, setIcon, setTooltip, requestUrl } = require("obsidian");
const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view");
const { Transaction } = require("@codemirror/state");
const { syntaxTree, foldEffect, unfoldEffect, foldedRanges } = require("@codemirror/language");

const { foldRegions } = require("./folding.js");
const DEFAULTS = { wrap: true, folding: true,
  formatWidth: 100, formatTabWidth: 2, formatSemi: true, formatSingleQuote: false, formatEmbedded: true,
  formatTrailingComma: "all", formatArrowParens: "always", formatSingleAttributePerLine: false,
  formatUseTabs: false, formatBracketSpacing: true, formatQuoteProps: "as-needed", formatJsxSingleQuote: false,
  formatObjectWrap: "preserve", formatBracketSameLine: false, formatVueIndentScriptAndStyle: false, formatHtmlWhitespaceSensitivity: "css" };
const FORMAT_LANGUAGES = new Set(["js", "javascript", "jsx", "mjs", "cjs", "ts", "typescript", "tsx", "html", "htm", "vue", "css", "scss", "less", "json", "jsonc", "json5", "yaml", "yml", "graphql", "gql", "java", "python", "py", "c", "cpp", "c++", "cxx", "cc"]);

function formatButton(doc, language, run, plugin, path, line) {
  const button = doc.createElement("button");
  button.type = "button";
  // 复用主题给原生复制按钮的外观；点击处理仍由本插件独立绑定。
  button.className = "qn-format-button copy-code-button";
  button.dataset.qnFormatPath = path || "";
  button.dataset.qnFormatLine = String(line);
  button.dataset.qnFormatLanguage = language;
  const supported = FORMAT_LANGUAGES.has(language.toLowerCase());
  setIcon(button, "paintbrush");
  setTooltip(button, "格式化此代码块");
  if (!supported) button.setAttribute("aria-disabled", "true");
  button.addEventListener("mousedown", event => event.preventDefault());
  const leaveFeedback = () => {
    if (plugin.formatResult?.target !== button) return;
    if (plugin.formatResult.result.ok) plugin.hideFormatPopup();
    else plugin.clearFormatFeedback();
  };
  for (const [event, key, active] of [
    ["mouseenter", "qnFormatHovered", true], ["mouseleave", "qnFormatHovered", false],
    ["focus", "qnFormatFocused", true], ["blur", "qnFormatFocused", false]
  ]) button.addEventListener(event, () => {
    button.dataset[key] = String(active);
    if (!supported) plugin.applyFormatFeedback(button);
    if (!active) leaveFeedback();
  });
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if (!supported) return;
    plugin.clearFormatFeedback();
    const request = plugin.formatFeedbackRequest = (plugin.formatFeedbackRequest || 0) + 1;
    button.qnOwnerView = plugin.app.workspace.getLeavesOfType("markdown").find(l => l.view.containerEl.contains(button))?.view;
    button.qnEditorMode = !!button.closest(".markdown-source-view");
    const callout = button.closest(".callout");
    button.qnCalloutExpanded = callout ? !callout.classList.contains("is-collapsed") : undefined;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const loadingTimer = setTimeout(() => {
      if (!plugin.unloaded && plugin.formatFeedbackRequest === request) setIcon(button, "loader-circle");
    }, 300);
    plugin.formatProgress = message => { if (plugin.formatFeedbackRequest === request) { setTooltip(button, message); button.setAttribute("aria-label", message); } };
    plugin.formatProgress("正在格式化…");
    try {
      const result = await run();
      if (plugin.formatFeedbackRequest === request) plugin.showFormatFeedback(result, button);
    } finally { clearTimeout(loadingTimer); button.disabled = false; button.removeAttribute("aria-busy"); plugin.formatProgress = null; }
  });
  plugin.applyFormatFeedback(button);
  return button;
}

function parseOptions(metadata = "") {
  return { language: (metadata.trim().split(/\s+/)[0] || "").toLowerCase() };
}

function bindDisplayFold(button, toggle) {
  // 阻止实时预览把按钮手势当成选中／编辑整个 Callout；保留原生键盘触发的 click。
  const consume = event => { event.preventDefault(); event.stopPropagation(); };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"]) button.addEventListener(type, consume);
  button.addEventListener("click", event => { consume(event); toggle(); });
}

function snapshotBlocks(source) {
  if (source.length > 2000000) return [];
  return require("./formatting.js").findCodeBlocks(source);
}

function resolveRenderedBlock(source, options, text) {
  if (Number.isInteger(options.sourceLine)) return options;
  const value = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const aliases = { javascript: "js", typescript: "ts", htm: "html", yml: "yaml" };
  const canonical = language => aliases[language] || language;
  const matches = snapshotBlocks(source).filter(block => canonical(block.language) === canonical(options.language) && block.value.replace(/\r\n/g, "\n") === value);
  if (matches.length > 1) throw new Error("笔记中存在多处相同代码，暂时无法确认目标。请把光标放入这个代码块，再使用编辑器中的格式化按钮。");
  if (!matches.length) throw new Error("当前显示与源码不一致，请先刷新这个代码块后重试。");
  return { ...options, sourceLine: matches[0].line - 1, sourceSnapshot: source };
}

function resolveLiveCalloutBlock(editorView, code, source) {
  if (!editorView?.posAtDOM || !editorView.dom.contains(code)) return null;
  let root = code.closest(".callout");
  if (!root) return null;
  // 嵌套 Callout 属于同一个编辑器块级 widget；映射外层容器，再校验整个序列。
  for (let parent = root.parentElement?.closest(".callout"); parent && editorView.dom.contains(parent);
    parent = root.parentElement?.closest(".callout")) root = parent;
  if (editorView.state.doc.toString() !== source) throw new Error("笔记源码已变化，请刷新显示后重试。");
  let anchor;
  try { anchor = editorView.posAtDOM(root, 0); } catch { return null; }
  if (!Number.isInteger(anchor) || anchor < 0 || anchor > source.length) return null;
  const line = source.slice(0, anchor).split("\n").length;
  const blocks = snapshotBlocks(source);
  const ranges = blocks.flatMap(block => block.quoteRanges || []).filter(range => range.line === line);
  // 同一行存在嵌套引用时取最外层范围；DOM 也从最外层 Callout 起算。
  const range = ranges.sort((a, b) => a.from - b.from || b.to - a.to)[0];
  if (!range) throw new Error("无法确认此容器的源码位置，请把光标放入代码块后重试。");
  const scoped = blocks.filter(block => block.from >= range.from && block.to <= range.to);
  return resolveScopedBlock(source, code, root, scoped);
}

function resolveReadingBlock(view, code, source) {
  const renderer = view.previewMode?.renderer;
  if (!renderer?.getSectionInfo || !renderer.getSectionForElement) return null;
  const info = renderer.getSectionInfo(code), root = renderer.getSectionForElement(code)?.el;
  if (!info || !root?.contains(code) || info.text !== source || !Number.isInteger(info.lineStart) || !Number.isInteger(info.lineEnd)) {
    throw new Error("区段显示与源码不一致，请刷新显示后重试。");
  }
  const scoped = snapshotBlocks(source).filter(block => block.line - 1 >= info.lineStart && block.line - 1 <= info.lineEnd);
  return resolveScopedBlock(source, code, root, scoped);
}

function resolveScopedBlock(source, code, root, scoped) {
  const rendered = Array.from(root.querySelectorAll("pre > code"));
  const aliases = { javascript: "js", typescript: "ts", htm: "html", yml: "yaml" };
  const canonical = value => aliases[value] || value;
  const identity = element => ({
    language: canonical(/(?:^|\s)language-([^\s]+)/.exec(element.className)?.[1]?.toLowerCase() || ""),
    text: element.textContent.replace(/\r\n/g, "\n").replace(/\n$/, "")
  });
  if (scoped.length !== rendered.length) {
    const target = identity(code);
    const candidates = scoped.filter(block => canonical(block.language) === target.language && block.value.replace(/\r\n/g, "\n") === target.text);
    const domMatches = rendered.filter(element => { const item = identity(element); return item.language === target.language && item.text === target.text; });
    if (candidates.length === 1 && domMatches.length === 1) return { sourceLine: candidates[0].line - 1, sourceSnapshot: source };
    throw new Error("容器显示与源码不一致，请刷新显示后重试。");
  }
  const matches = scoped.length === rendered.length && rendered.every((element, index) => {
    const language = /(?:^|\s)language-([^\s]+)/.exec(element.className)?.[1]?.toLowerCase() || "";
    const text = element.textContent.replace(/\r\n/g, "\n").replace(/\n$/, "");
    return canonical(language) === canonical(scoped[index].language) && text === scoped[index].value.replace(/\r\n/g, "\n");
  });
  const index = rendered.indexOf(code);
  if (!matches || index < 0) throw new Error("容器显示与源码不一致，请刷新显示后重试。");
  return { sourceLine: scoped[index].line - 1, sourceSnapshot: source };
}
// 嵌套块依照 Markdown 语法树定位，不把字符串中的反引号或紧凑引用符当作容器边界。
function sectionOptions(info) {
  if (!info) return [];
  return snapshotBlocks(info.text).filter(block => block.line - 1 >= info.lineStart && block.line - 1 <= info.lineEnd)
    .map(block => ({ ...parseOptions(`${block.language} ${block.meta}`), sourceLine: block.line - 1 }));
}

// Tab 必须按制表位展开，不能把一个 Tab 简单视为一个字符。
function indentColumns(text, tabSize = 4) {
  let columns = 0;
  for (const character of text) {
    if (character === " ") columns++;
    else if (character === "\t") columns += tabSize - columns % tabSize;
    else break;
  }
  return columns;
}

// 通过 DOM Range 分割高亮后的文本，保留跨行注释等 token 的嵌套结构。
function splitHighlightedLines(code) {
  const doc = code.ownerDocument;
  const walker = doc.createTreeWalker(code, 4);
  const nodes = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodes.push({ node, start: offset, end: offset + node.length });
    offset += node.length;
  }
  let nodeIndex = 0;
  const position = (index) => {
    while (nodeIndex < nodes.length - 1 && index > nodes[nodeIndex].end) nodeIndex++;
    const item = nodes[nodeIndex];
    return item ? [item.node, index - item.start] : [code, 0];
  };
  let start = 0;
  return (code.textContent || "").split("\n").map(text => {
    const range = doc.createRange();
    range.setStart(...position(start));
    range.setEnd(...position(start + text.length));
    start += text.length + 1;
    let content = range.cloneContents();
    // cloneContents 不包含共同祖先；同一注释 token 跨行时需补回这层样式。
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === 3) ancestor = ancestor.parentNode;
    while (ancestor && ancestor !== code) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.append(content);
      content = doc.createDocumentFragment();
      content.append(wrapper);
      ancestor = ancestor.parentNode;
    }
    return { text, content };
  });
}

function textSlice(fragment, from, to, doc) {
  const root = doc.createElement("code");
  root.append(fragment.cloneNode(true));
  const walker = doc.createTreeWalker(root, 4);
  const nodes = [];
  let start = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodes.push({ node, start, end: start + node.length });
    start += node.length;
  }
  const point = offset => {
    const item = nodes.find(n => offset >= n.start && offset <= n.end);
    return item ? [item.node, offset - item.start] : [root, 0];
  };
  const range = doc.createRange();
  range.setStart(...point(from));
  range.setEnd(...point(to));
  let result = range.cloneContents();
  let ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === 3) ancestor = ancestor.parentNode;
  while (ancestor && ancestor !== root) {
    const parent = ancestor.cloneNode(false);
    parent.append(result);
    result = doc.createDocumentFragment();
    result.append(parent);
    ancestor = ancestor.parentNode;
  }
  return result;
}

class WrappedCode extends MarkdownRenderChild {
  constructor(code, plugin, options = parseOptions(), sourcePath = "") {
    super(code);
    this.code = code;
    this.plugin = plugin;
    this.options = options;
    this.sourcePath = sourcePath;
  }

  onload() {
    this.plugin.blocks.add(this);
    this.observer = new MutationObserver(() => this.render());
    this.resizeObserver = new ResizeObserver(() => {
      if (this.widthFrame) return;
      this.widthFrame = requestAnimationFrame(() => {
        this.widthFrame = 0;
        this.updateWidth();
      });
    });
    this.resizeObserver.observe(this.code);
    this.updateWidth();
    this.render();
    this.observe();
  }

  observe() {
    this.observer.observe(this.code, { childList: true, subtree: true, characterData: true });
  }

  updateWidth() {
    const value = `${this.code.clientWidth * 0.6}px`;
    if (this.code.style.getPropertyValue("--qn-indent-cap") !== value) {
      this.code.style.setProperty("--qn-indent-cap", value);
    }
  }

  restore() {
    if (this.plugin.formatResult?.target === this.formatControl) this.plugin.clearFormatFeedback();
    if (this.original) this.code.replaceChildren(this.original.cloneNode(true));
    this.code.classList.remove("qn-wrapped-code");
    this.formatControl?.remove();
    this.formatControl = null;
    this.original = null;
  }

  render() {
    this.observer?.disconnect();
    try {
      // Prism 可能异步替换内容；只处理原生代码，不接管其他插件的渲染结果。
      if (this.code.querySelector(":scope > .qn-code-line")) return;
      this.original = this.code.ownerDocument.createDocumentFragment();
      for (const child of this.code.childNodes) this.original.append(child.cloneNode(true));
      const text = this.code.textContent || "";
      const tabSize = parseInt(getComputedStyle(this.code).tabSize, 10) || 4;
      const lines = splitHighlightedLines(this.code);
      if (this.sourceText !== text) this.collapsedRegions = new Set();
      this.sourceText = text;
      this.lines = lines;
      this.regions = this.plugin.settings.folding ? foldRegions(text, this.options.language, tabSize) : [];
      const fragment = this.code.ownerDocument.createDocumentFragment();
      lines.forEach((line, index) => {
        const row = this.code.ownerDocument.createElement("span");
        row.className = "qn-code-line";
        row.style.setProperty("--qn-source-indent", `${indentColumns(line.text, tabSize)}ch`);
        row.style.setProperty("--qn-indent", `${this.plugin.settings.wrap ? indentColumns(line.text, tabSize) : 0}ch`);
        row.append(line.content.cloneNode(true));
        // 最后的空行只是源代码的结尾换行，不额外增加可见空白行。
        if (!line.text && index === lines.length - 1) row.classList.add("qn-final-empty");
        fragment.append(row);
        if (index < lines.length - 1) fragment.append("\n");
      });
      if (fragment.textContent !== text) throw new Error("Code Block Enhancements: code text mismatch");
      this.code.replaceChildren(fragment);
      this.code.classList.add("qn-wrapped-code");
      this.updateWidth();
      if (!this.formatControl) {
        this.formatControl = formatButton(this.code.ownerDocument, this.options.language, async () => {
          const leaf = this.plugin.app.workspace.getLeavesOfType("markdown").find(l =>
            l.view.file?.path === this.sourcePath && (l.view.containerEl.contains(this.code) || this.editorView && l.view.editor?.cm === this.editorView));
          try {
            if (!leaf) throw new Error("代码块暂未连接到笔记，请刷新显示后重试。");
            if (!this.options.language) this.options.language = /(?:^|\s)language-([^\s]+)/.exec(this.code.className)?.[1]?.toLowerCase() || "";
            const source = leaf.view.getMode() === "source" ? leaf.view.editor.getValue() : leaf.view.getViewData();
            const mapped = leaf.view.getMode() === "source" ? resolveLiveCalloutBlock(leaf.view.editor.cm, this.code, source) : resolveReadingBlock(leaf.view, this.code, source);
            this.options = mapped ? { ...this.options, ...mapped } : resolveRenderedBlock(source, this.options, this.sourceText);
            this.formatControl.dataset.qnFormatLine = String(this.options.sourceLine);
            return this.plugin.formatCodeBlock(leaf.view, this.options.sourceLine, this.sourceText, this.options.sourceSnapshot);
          } catch (error) { return { ok: false, message: `格式化失败：${error.message}` }; }
        }, this.plugin, this.sourcePath, this.options.sourceLine);
        this.code.before(this.formatControl);
      }
      this.applyFolds();
    } finally {
      if (this.observer && this.plugin.blocks.has(this)) this.observe();
    }
  }

  toggleRegion(region) {
    if (this.collapsedRegions.has(region.from)) this.collapsedRegions.delete(region.from);
    else this.collapsedRegions.add(region.from);
    this.observer.disconnect();
    try { this.applyFolds(); } finally { this.observe(); }
    this.plugin.scheduleLayout(this.code);
  }

  applyFolds() {
    const doc = this.code.ownerDocument;
    const collapsed = this.regions.filter(r => this.collapsedRegions.has(r.from));
    this.code.querySelectorAll(":scope > .qn-code-line").forEach((row, index) => {
      const line = this.lines[index];
      row.replaceChildren(line.content.cloneNode(true));
      row.hidden = collapsed.some(r => index > r.startLine && (index < r.endLine ||
        index === r.endLine && !line.text.slice(r.endColumn).trim()));
      if (row.hidden) return;
      const starts = this.regions.find(r => r.startLine === index);
      const ends = collapsed.find(r => r.endLine === index);
      if (ends && ends.endColumn > 0) {
        const leading = line.text.match(/^\s*/)[0].length;
        row.replaceChildren(textSlice(line.content, 0, leading, doc));
        const hidden = doc.createElement("span");
        hidden.hidden = true;
        hidden.append(textSlice(line.content, leading, Math.max(leading, ends.endColumn), doc));
        row.append(hidden, textSlice(line.content, Math.max(leading, ends.endColumn), line.text.length, doc));
      }
      if (starts) {
        const isCollapsed = this.collapsedRegions.has(starts.from);
        if (isCollapsed) {
          row.replaceChildren(textSlice(line.content, 0, starts.startColumn, doc));
          const placeholder = doc.createElement("button");
          placeholder.className = "qn-fold-placeholder";
          placeholder.type = "button";
          setTooltip(placeholder, "单击以展开范围");
          bindDisplayFold(placeholder, () => this.toggleRegion(starts));
          const hidden = doc.createElement("span");
          hidden.hidden = true;
          hidden.append(textSlice(line.content, starts.startColumn, line.text.length, doc));
          row.append(placeholder, hidden);
        }
        const toggle = doc.createElement("button");
        toggle.type = "button";
        toggle.className = `qn-fold-toggle collapse-indicator collapse-icon${isCollapsed ? " is-collapsed" : ""}`;
        setTooltip(toggle, isCollapsed ? "单击以展开范围" : "单击以折叠范围");
        toggle.setAttribute("aria-expanded", String(!isCollapsed));
        setIcon(toggle, "right-triangle");
        bindDisplayFold(toggle, () => this.toggleRegion(starts));
        row.prepend(toggle);
      }
    });
  }

  refresh(setting) {
    this.observer.disconnect();
    try {
      if (setting === "wrap") {
        for (const row of this.code.querySelectorAll(":scope > .qn-code-line")) {
          row.style.setProperty("--qn-indent", this.plugin.settings.wrap ? row.style.getPropertyValue("--qn-source-indent") : "0ch");
        }
      } else if (setting === "folding") {
        const tabSize = parseInt(getComputedStyle(this.code).tabSize, 10) || 4;
        this.regions = this.plugin.settings.folding ? foldRegions(this.sourceText, this.options.language, tabSize) : [];
        if (!this.plugin.settings.folding) this.collapsedRegions.clear();
        this.applyFolds();
      }
    } finally { this.observe(); }
    this.plugin.scheduleLayout(this.code);
  }

  onunload() {
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    if (this.widthFrame) cancelAnimationFrame(this.widthFrame);
    this.restore();
    this.code.style.removeProperty("--qn-indent-cap");
    this.plugin.blocks.delete(this);
  }
}

function editorBlocks(state, previous = []) {
  const events = new Map();
  const reusable = new Map(previous.map(block => [block.cacheKey, block]));
  // 完整围栏索引不依赖宿主语法树的后台解析进度；正文内单行编辑可安全映射既有范围。
  const source = state.doc.toString();
  if (source.length <= 2000000) {
    for (const block of snapshotBlocks(source)) {
      if (!block.closed) continue;
      events.set(state.doc.line(block.line).from, "begin");
      events.set(state.doc.lineAt(block.bodyTo).from, "end");
    }
  } else {
    syntaxTree(state).iterate({ enter(node) {
      const begin = node.name.includes("HyperMD-codeblock-begin"), end = node.name.includes("HyperMD-codeblock-end");
      if (begin || end) events.set(state.doc.lineAt(node.from).from, begin ? "begin" : "end");
    } });
  }
  const blocks = [];
  let open = null;
  for (const [from, kind] of Array.from(events).sort((a, b) => a[0] - b[0])) {
    if (kind === "begin") open = state.doc.lineAt(from);
    else if (open) {
      const close = state.doc.lineAt(from);
      blocks.push(editorBlock(state, open, close, source.slice(open.from, close.to), reusable));
      open = null;
    }
  }
  return blocks;
}

function editorBlock(state, open, close, text = state.doc.sliceString(open.from, close.to), reusable) {
  const cacheKey = `${state.tabSize}\0${text}`;
  const cached = reusable?.get(cacheKey);
  if (cached) {
    const shift = open.from - cached.open.from;
    return { ...cached, open, close, regions: cached.regions.map(r => ({ from: r.from + shift, to: r.to + shift, line: r.line + shift })) };
  }
  const metadata = /(?:`{3,}|~{3,})(.*)$/.exec(open.text)?.[1] || "";
  const options = parseOptions(metadata);
  const prefix = open.text.slice(0, open.text.search(/`{3,}|~{3,}/));
  const quoteCount = (prefix.match(/>/g) || []).length;
  const sourceLines = [], offsets = [], sourceStarts = [];
  let sourceLength = 0;
  for (let number = open.number + 1; number < close.number; number++) {
    const line = state.doc.line(number);
    let removed = 0;
    if (quoteCount) {
      const container = new RegExp(`^(?:\\s*> ?){${quoteCount}}`).exec(line.text)?.[0] || "";
      removed = container.length;
    } else if (prefix.trim() === "") removed = line.text.startsWith(prefix) ? prefix.length : 0;
    else if (/^\s*[-+*]\s/.test(prefix)) removed = Math.min(prefix.length, line.text.match(/^\s*/)[0].length);
    const text = line.text.slice(removed);
    sourceStarts.push(sourceLength);
    offsets.push(line.from + removed);
    sourceLines.push(text);
    sourceLength += text.length + 1;
  }
  const source = sourceLines.join("\n");
  const regions = foldRegions(source, options.language, state.tabSize).map(region => {
    let end = region.to;
    // 有闭括号的结构保留结束行，和 VS Code 的逐行折叠观感一致。
    if (sourceLines[region.endLine]?.slice(region.endColumn).trim()) {
      const newline = source.lastIndexOf("\n", region.to - 1);
      if (newline > region.from) end = newline;
    }
    const endLine = end === region.to ? region.endLine : Math.max(region.startLine, region.endLine - 1);
    return {
      from: offsets[region.startLine] + region.startColumn,
      to: offsets[endLine] + end - sourceStarts[endLine],
      line: state.doc.lineAt(offsets[region.startLine]).from
    };
  }).filter(region => region.to > region.from);
  return { open, close, options, regions, quoteCount, cacheKey };
}

// 只优化不能改变围栏/容器边界的单行编辑。换行、围栏、引用前缀及复杂 Markdown 改动走完整重建。
function remapEditorBlocks(blocks, update) {
  const { changes, startState, state } = update, touched = new Set();
  if (startState.doc.length > 2000000 || state.doc.length > 2000000) return null;
  let safe = true;
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (!safe) return;
    const before = startState.doc.lineAt(fromA), after = state.doc.lineAt(fromB);
    if (toA > before.to || toB > after.to || inserted.lines !== 1) { safe = false; return; }
    const block = blocks.find(b => fromA <= b.close.to && toA >= b.open.from);
    if (block) {
      if (before.number <= block.open.number || before.number >= block.close.number ||
          /`{3,}|~{3,}/.test(before.text + after.text)) { safe = false; return; }
      const prefix = block.quoteCount ? new RegExp(`^(?:\\s*> ?){${block.quoteCount}}[\\t ]*`) : /^\s*/;
      const oldPrefix = prefix.exec(before.text)?.[0], newPrefix = prefix.exec(after.text)?.[0];
      if (oldPrefix === undefined || oldPrefix !== newPrefix || fromA < before.from + oldPrefix.length) { safe = false; return; }
      touched.add(block);
    } else {
      // 前缀不变的标题、列表、引用和强调文字不改变围栏归属；空行/HTML 等仍需完整检查。
      const prefix = /^(?:[\t ]*(?:> ?|(?:[-+*]|\d{1,9}[.)])[\t ]+))*[\t ]*(?:#{1,6}[\t ]+)?(?:\*\*|__|\*|_)?/;
      const oldPrefix = prefix.exec(before.text)[0], newPrefix = prefix.exec(after.text)[0];
      const oldBody = before.text.slice(oldPrefix.length), newBody = after.text.slice(newPrefix.length);
      const prose = /^[\p{L}\p{N}\u3000-\u303f\uff00-\uffef“”‘’]/u;
      if (oldPrefix !== newPrefix || fromA < before.from + oldPrefix.length || !prose.test(oldBody) || !prose.test(newBody) || /[<>]/.test(oldBody + newBody)) safe = false;
    }
  }, true);
  if (!safe) return null;
  return blocks.map(block => {
    const open = state.doc.lineAt(changes.mapPos(block.open.from, 1));
    const close = state.doc.lineAt(changes.mapPos(block.close.from, 1));
    if (touched.has(block)) return editorBlock(state, open, close);
    return { ...block, open, close, regions: block.regions.map(r => ({
      from: changes.mapPos(r.from, 1), to: changes.mapPos(r.to, -1), line: changes.mapPos(r.line, 1)
    })) };
  });
}

class StructureFoldWidget extends WidgetType {
  constructor(plugin, region, collapsed) { super(); this.plugin = plugin; this.region = region; this.collapsed = collapsed; }
  eq(other) { return this.region.from === other.region.from && this.region.to === other.region.to && this.collapsed === other.collapsed; }
  toDOM(view) {
    const button = view.dom.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `qn-fold-toggle collapse-indicator collapse-icon${this.collapsed ? " is-collapsed" : ""}`;
    setTooltip(button, this.collapsed ? "单击以展开范围" : "单击以折叠范围");
    button.setAttribute("aria-expanded", String(!this.collapsed));
    setIcon(button, "right-triangle");
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", event => {
      event.preventDefault();
      const { from, to, line } = this.region;
      const owned = this.plugin.ownedFolds.get(view) || [];
      this.plugin.ownedFolds.set(view, this.collapsed ? owned.filter(r => r.from !== from || r.to !== to) : [...owned, { from, to }]);
      const selectionInside = view.state.selection.ranges.some(r => r.from > from && r.from < to || r.to > from && r.to < to);
      view.dispatch({ effects: (this.collapsed ? unfoldEffect : foldEffect).of({ from, to }),
        ...(!this.collapsed && selectionInside ? { selection: { anchor: line } } : {}) });
    });
    return button;
  }
  ignoreEvent() { return true; }
}

class FormatCodeWidget extends WidgetType {
  constructor(plugin, block, active) { super(); this.plugin = plugin; this.line = block.open.number - 1; this.start = block.open.from; this.language = block.options.language; this.active = active; }
  eq(other) { return this.line === other.line && this.language === other.language && this.active === other.active && this.start === other.start; }
  toDOM(view) {
    const owner = this.plugin.app.workspace.getLeavesOfType("markdown").find(l => l.view.editor?.cm === view);
    const button = formatButton(view.dom.ownerDocument, this.language, async () => {
      const leaf = this.plugin.app.workspace.getLeavesOfType("markdown").find(l => l.view.editor?.cm === view);
      return this.plugin.formatCodeBlock(leaf?.view, this.line);
    }, this.plugin, owner?.view.file?.path, this.line);
    button.classList.add("qn-editor-format-button", "code-block-flair");
    button.dataset.qnBlock = String(this.start);
    button.dataset.qnKeyboardActive = String(this.active);
    return button;
  }
  ignoreEvent() { return true; }
}

function editorWrapping(plugin) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view; this.decorations = this.build(view); this.alignButtons(view);
      this.calloutObserver = new MutationObserver(() => this.scanCallouts());
      this.calloutObserver.observe(view.dom, { childList: true, subtree: true });
      this.scanCallouts();
    }
    scanCallouts() {
      if (this.calloutFrame || plugin.unloaded) return;
      this.calloutFrame = requestAnimationFrame(() => {
        this.calloutFrame = 0;
        plugin.enhanceLiveCallouts(this.view);
      });
    }
    destroy() {
      this.calloutObserver.disconnect();
      if (this.calloutFrame) cancelAnimationFrame(this.calloutFrame);
      for (const child of plugin.liveCalloutBlocks || []) {
        if (child.editorView === this.view) { plugin.removeChild(child); plugin.liveCalloutBlocks.delete(child); }
      }
      plugin.ownedFolds.delete(this.view);
    }
    alignButtons(view) {
      view.requestMeasure({
        key: this,
        read: () => plugin.unloaded ? [] : Array.from(view.dom.querySelectorAll(".qn-editor-format-button")).map(button => {
          const host = button.closest(".cm-line");
          const flair = host?.querySelector(".code-block-flair:not(.qn-format-button)");
          if (!host) return null;
          const parent = host.getBoundingClientRect(), label = flair?.getBoundingClientRect();
          const height = 28;
          const top = label?.height ? label.top - parent.top + (label.height - height) / 2 : 0;
          return { button, height, right: label?.width ? parent.right - label.left + 6 : 8, top };
        }).filter(Boolean),
        write: measurements => {
          if (plugin.unloaded) return;
          for (const { button, height, right, top } of measurements) {
            const nextRight = `${right}px`, nextTop = `${top}px`;
            if (button.style.insetInlineEnd !== nextRight) button.style.insetInlineEnd = nextRight;
            if (button.style.top !== nextTop) button.style.top = nextTop;
            if (button.style.height !== `${height}px`) button.style.height = `${height}px`;
          }
        }
      });
    }
    update(update) {
      if (update.selectionSet && plugin.formatResult?.view?.editor?.cm === update.view) plugin.clearFormatFeedback();
      if (update.docChanged && plugin.ownedFolds.has(update.view)) {
        plugin.ownedFolds.set(update.view, plugin.ownedFolds.get(update.view).map(r => ({
          from: update.changes.mapPos(r.from, 1), to: update.changes.mapPos(r.to, -1)
        })).filter(r => r.to > r.from));
      }
      if (update.docChanged && this.doc === update.startState.doc && this.blocks) {
        const mapped = remapEditorBlocks(this.blocks, update);
        if (mapped) { this.blocks = mapped; this.doc = update.state.doc; }
      }
      if (this.revision !== plugin.revision || update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet || update.transactions.some(t => t.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect))) ||
          syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = this.build(update.view);
        this.alignButtons(update.view);
      }
    }
    build(view) {
      this.revision = plugin.revision;
      if (this.doc !== view.state.doc || !this.blocks || view.state.doc.length > 2000000 && this.tree !== syntaxTree(view.state)) {
        this.doc = view.state.doc;
        this.tree = syntaxTree(view.state);
        this.blocks = editorBlocks(view.state, this.blocks);
      }
      const positions = new Set();
      const tree = syntaxTree(view.state);
      for (const range of view.visibleRanges) {
        tree.iterate({ from: range.from, to: range.to, enter(node) {
          if (!node.name.includes("HyperMD-codeblock") || /codeblock-(begin|end)/.test(node.name)) return;
          const first = view.state.doc.lineAt(node.from).number;
          const last = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let number = first; number <= last; number++) {
            positions.add(view.state.doc.line(number).from);
          }
        } });
      }
      // 引用围栏不一定带宿主 codeblock token；正文行仍需悬停归属、折叠入口和定位样式。
      for (const block of this.blocks) if (block.quoteCount) for (const range of view.visibleRanges) {
        const first = Math.max(block.open.number + 1, view.state.doc.lineAt(range.from).number);
        const last = Math.min(block.close.number - 1, view.state.doc.lineAt(range.to).number);
        for (let number = first; number <= last; number++) positions.add(view.state.doc.line(number).from);
      }
      const tabSize = view.state.tabSize;
      const folds = foldedRanges(view.state);
      const decorations = Array.from(positions).sort((a, b) => a - b).map(from => {
        const line = view.state.doc.lineAt(from);
        const block = this.blocks.find(b => line.number > b.open.number && line.number < b.close.number);
        const quotePrefix = block?.quoteCount ? new RegExp(`^(?:\\s*> ?){${block.quoteCount}}`).exec(line.text)?.[0] || "" : "";
        const columns = indentColumns(quotePrefix.replace(/>/g, " ") + line.text.slice(quotePrefix.length), tabSize);
        return Decoration.line({ attributes: {
          class: "qn-editor-code-line",
          ...(block ? { "data-qn-block": String(block.open.from) } : {}),
          ...(plugin.settings.folding && block?.regions.length ? { "data-qn-structure": "true" } : {}),
          style: `--qn-source-indent:${columns}ch;--qn-indent:${plugin.settings.wrap ? columns : 0}ch;--qn-indent-cap:${view.contentDOM.clientWidth * 0.6}px`
        } }).range(from);
      });
      for (const block of this.blocks) {
        if (view.visibleRanges.some(r => block.open.from >= r.from && block.open.from <= r.to)) {
          decorations.push(Decoration.line({ attributes: { class: "qn-editor-code-header", "data-qn-block": String(block.open.from) } }).range(block.open.from));
        }
        const selection = view.state.selection.ranges.find(r => r.head >= block.open.from && r.head <= block.close.to);
        const anchor = block.open.from;
        if (view.visibleRanges.some(r => anchor >= r.from && anchor <= r.to)) {
          decorations.push(Decoration.widget({ widget: new FormatCodeWidget(plugin, block, !!selection), side: -1 }).range(anchor));
        }
        if (plugin.settings.folding) for (const region of block.regions) {
          if (!view.visibleRanges.some(r => region.line >= r.from && region.line <= r.to)) continue;
          let collapsed = false;
          folds.between(region.from, region.to, (from, to) => { if (from === region.from && to === region.to) collapsed = true; });
          decorations.push(Decoration.widget({ widget: new StructureFoldWidget(plugin, region, collapsed), side: -1 }).range(region.line));
        }
      }
      return Decoration.set(decorations, true);
    }
  }, {
    decorations: value => value.decorations,
    eventHandlers: {
      mouseover(event, view) {
        const block = event.target.closest?.(".cm-line")?.dataset.qnBlock;
        view.dom.querySelectorAll(".qn-editor-format-button").forEach(button => {
          button.dataset.qnHover = String(button.dataset.qnBlock === block);
        });
        const target = event.target.closest?.(".qn-editor-code-line .cm-foldPlaceholder");
        if (target && !target.dataset.qnTooltip) {
          target.removeAttribute("title");
          setTooltip(target, "单击以展开范围");
          target.dataset.qnTooltip = "true";
        }
      },
      mouseleave(_event, view) {
        view.dom.querySelectorAll(".qn-editor-format-button").forEach(button => { button.dataset.qnHover = "false"; });
      }
    }
  });
}

class CodeBlockEnhancementsSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.classList.add("qn-settings");
    const doc = containerEl.ownerDocument;
    const details = (parent, title, paragraphs, example) => {
      const element = doc.createElement("details"); element.className = "qn-settings-details";
      const summary = doc.createElement("summary"); summary.textContent = title; element.append(summary);
      const body = doc.createElement("div"); body.className = "qn-settings-details-body";
      for (const text of paragraphs) { const p = doc.createElement("p"); p.textContent = text; body.append(p); }
      if (example) { const pre = doc.createElement("pre"), code = doc.createElement("code"); code.textContent = example; pre.append(code); body.append(pre); }
      element.append(body);
      parent.append(element);
    };
    new Setting(containerEl).setName(this.plugin.manifest.name).setHeading();
    new Setting(containerEl).setName("代码块显示").setHeading()
      .setDesc("仅调整显示效果，不修改笔记源码。");
    new Setting(containerEl).setName("换行后保留缩进")
      .setDesc("代码自动换行后，让续行与原行缩进对齐。不控制是否自动换行。")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.wrap).onChange(async value => {
        this.plugin.settings.wrap = value;
        await this.plugin.saveSettings("wrap");
      }));
    const foldingSetting = new Setting(containerEl).setName("代码结构折叠")
      .setDesc("显示代码内部的折叠箭头，初始不折叠任何内容。支持的语言按代码结构识别；其他语言按缩进层级兜底，缩进不规范时可能不准确。")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.folding).onChange(async value => {
        this.plugin.settings.folding = value;
        await this.plugin.saveSettings("folding");
      }));
    details(foldingSetting.descEl, "支持的语言与识别方式", [
      "按语法结构识别：Java、JS/TS（含 JSX/TSX）、Python、C/C++、Go、Rust、HTML/XML、CSS/SCSS/Less、JSON/JSONC、YAML、Markdown、SQL、PHP。",
      "SQL 主要识别语句和括号组。其他语言按缩进层级折叠，结果取决于代码排版。"
    ]);
    new Setting(containerEl).setName("代码块格式化").setHeading()
      .setDesc("点击代码块右上角的画刷，只整理这个代码块。修改设置不会立即改写代码，下次点击时才生效。");
    const overviewCard = doc.createElement("div"); overviewCard.className = "qn-formatter-overview-card";
    containerEl.append(overviewCard);
    const overview = doc.createElement("table"); overview.className = "qn-formatter-overview";
    const caption = doc.createElement("caption"); caption.textContent = "各语言使用的格式化工具"; overview.append(caption);
    const head = doc.createElement("thead"), header = doc.createElement("tr");
    for (const label of ["代码语言", "格式化工具", "设置方式"]) { const th = doc.createElement("th"); th.scope = "col"; th.textContent = label; header.append(th); }
    head.append(header); overview.append(head);
    const body = doc.createElement("tbody");
    for (const [language, tool, scope] of [
      ["Java、JS/TS、Vue、HTML、CSS/SCSS/Less、JSON、YAML、GraphQL", "Prettier（含 Java 扩展）", "下方可调"],
      ["Python", "Black", "固定风格"],
      ["C/C++", "clang-format", "固定风格"]
    ]) {
      const row = doc.createElement("tr"), name = doc.createElement("th"); name.scope = "row"; name.textContent = language; row.append(name);
      for (const value of [tool, scope]) {
        const cell = doc.createElement("td");
        if (value === "Prettier（含 Java 扩展）") {
          cell.append(doc.createTextNode("Prettier"));
          const note = doc.createElement("span"); note.className = "qn-tool-note"; note.textContent = "（含 Java 扩展）"; cell.append(note);
        } else cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
    overview.append(body); overviewCard.append(overview);
    const download = doc.createElement("div"); download.className = "qn-formatter-download";
    for (const text of [
      "Prettier 已包含 Java 扩展，支持的语言均可直接使用，无需下载额外组件。",
      "Python 目前仅支持 Windows x64。首次使用下载约 13.3 MB 组件，无需自行安装 Python；C/C++ 首次使用下载约 2.6 MB。下载后均可离线使用。"
    ]) {
      const p = doc.createElement("p");
      for (const part of text.split(/(Windows x64|13\.3 MB|2\.6 MB)/)) {
        if (/^(Windows x64|13\.3 MB|2\.6 MB)$/.test(part)) { const strong = doc.createElement("strong"); strong.textContent = part; p.append(strong); }
        else p.append(doc.createTextNode(part));
      }
      download.append(p);
    }
    details(download, "Python、C/C++ 的默认风格与运行说明", [
      "Python 使用 Black 默认风格：行宽 88、4 空格缩进。插件自动准备专用运行时，不修改系统 Python 或 PATH。首次初始化后复用后台进程，空闲 5 分钟释放。",
      "C/C++ 使用 clang-format 的 LLVM 默认风格：行宽 80、2 空格缩进，保留 #include 原有顺序。",
      "这两个工具不读取笔记目录的配置，也不使用下方 Prettier 偏好。"
    ]);
    overviewCard.append(download);
    const formatterEl = containerEl.ownerDocument.createElement("div");
    formatterEl.className = "qn-settings-formatter";
    formatterEl.setAttribute("role", "group");
    formatterEl.setAttribute("aria-labelledby", "qn-prettier-heading");
    containerEl.append(formatterEl);
    const formatterHeading = new Setting(formatterEl).setName("Prettier 格式化偏好").setHeading()
      .setDesc("用于 Java（Prettier Java）及上表中的 Prettier 语言，不影响 Python 和 C/C++。每项只在适用的语言中生效。");
    formatterHeading.nameEl.id = "qn-prettier-heading";
    new Setting(formatterEl).setName("行宽与缩进").setHeading().settingEl.classList.add("qn-settings-subheading");
    const widthSetting = new Setting(formatterEl).setName("参考行宽");
    widthSetting.settingEl.classList.add("qn-setting-width");
    const error = containerEl.ownerDocument.createElement("div");
    error.className = "qn-setting-error";
    error.id = "qn-format-width-error";
    error.hidden = true;
    error.setAttribute("role", "status");
    widthSetting.setDesc("每行希望容纳的字符数（40–200）。只是排版目标，长字符串等仍可能超出。");
    widthSetting.descEl.append(error);
    widthSetting.addText(input => {
      input.setValue(String(this.plugin.settings.formatWidth));
      const el = input.inputEl;
      el.type = "number";
      el.min = "40"; el.max = "200"; el.step = "1";
      el.inputMode = "numeric";
      el.setAttribute("aria-describedby", error.id);
      el.addEventListener("blur", () => {
        if (!el.hasAttribute("aria-invalid")) return;
        input.setValue(String(this.plugin.settings.formatWidth));
        el.removeAttribute("aria-invalid");
        error.hidden = true;
      });
      input.onChange(async value => {
        const text = value.trim(), number = Number(text);
        if (!/^\d+$/.test(text) || number < 40 || number > 200) {
          input.inputEl.setAttribute("aria-invalid", "true");
          error.textContent = "请输入 40–200 范围内的整数；当前设置未改变。";
          error.hidden = false;
          return;
        }
        input.inputEl.removeAttribute("aria-invalid");
        error.hidden = true;
        if (number === this.plugin.settings.formatWidth) return;
        this.plugin.settings.formatWidth = number;
        await this.plugin.saveSettings();
      });
    });
    new Setting(formatterEl).setName("缩进方式")
      .setDesc("使用空格或 Tab 字符缩进；使用 Tab 时，部分对齐仍会使用空格。")
      .addDropdown(dropdown => dropdown.addOptions({ spaces: "空格", tabs: "Tab" })
        .setValue(this.plugin.settings.formatUseTabs ? "tabs" : "spaces").onChange(async value => {
          this.plugin.settings.formatUseTabs = value === "tabs";
          await this.plugin.saveSettings();
        }));
    new Setting(formatterEl).setName("缩进宽度")
      .setDesc("每级缩进几格；选 Tab 时，表示一个 Tab 对应的列宽。")
      .addDropdown(dropdown => dropdown.addOptions({ 2: "2", 4: "4", 8: "8" })
        .setValue(String(this.plugin.settings.formatTabWidth)).onChange(async value => {
          this.plugin.settings.formatTabWidth = Number(value);
          await this.plugin.saveSettings();
        }));
    new Setting(formatterEl).setName("标点、引号与对象").setHeading().settingEl.classList.add("qn-settings-subheading");
    new Setting(formatterEl).setName("语句末尾添加分号")
      .setDesc("适用于 JS/TS。开启时添加分号；关闭时移除可省分号，仍保留防止语句歧义所需的分号。不影响 CSS 分号。")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.formatSemi).onChange(async value => {
        this.plugin.settings.formatSemi = value;
        await this.plugin.saveSettings();
      }));
    new Setting(formatterEl).setName("末尾逗号")
      .setDesc("控制多行结构最后一项后的可选逗号，按语言语法处理。标准 JSON 不添加末尾逗号。")
      .addDropdown(dropdown => dropdown.addOptions({ none: "不添加", es5: "对象、数组等（不含函数参数）", all: "所有允许位置（含函数参数）" })
        .setValue(this.plugin.settings.formatTrailingComma ?? "all").onChange(async value => {
          this.plugin.settings.formatTrailingComma = value;
          await this.plugin.saveSettings();
        }));
    new Setting(formatterEl).setName("箭头函数参数括号")
      .setDesc("适用于 JS/TS。“能省则省”会移除可选括号，不是保留源码原样；语法必需的括号始终保留。")
      .addDropdown(dropdown => dropdown.addOptions({ always: "始终添加 (x) => x", avoid: "能省则省 x => x" })
        .setValue(this.plugin.settings.formatArrowParens ?? "always").onChange(async value => {
          this.plugin.settings.formatArrowParens = value;
          await this.plugin.saveSettings();
        }));
    new Setting(formatterEl).setName("字符串引号偏好")
      .setDesc("将普通字符串改为所选引号，不保留原有引号；为减少转义可能使用另一种引号。不影响 JSON 和 JSX 属性。")
      .addDropdown(dropdown => dropdown.addOptions({ double: '优先双引号 "hello"', single: "优先单引号 'hello'" })
        .setValue(this.plugin.settings.formatSingleQuote ? "single" : "double").onChange(async value => {
          this.plugin.settings.formatSingleQuote = value === "single";
          await this.plugin.saveSettings();
        }));
    new Setting(formatterEl).setName("JSX 属性引号")
      .setDesc("仅控制 JSX/TSX 标签属性的引号，与普通字符串的引号偏好独立。")
      .addDropdown(dropdown => dropdown.addOptions({ double: '双引号 id="demo"', single: "单引号 id='demo'" })
        .setValue(this.plugin.settings.formatJsxSingleQuote ? "single" : "double").onChange(async value => {
          this.plugin.settings.formatJsxSingleQuote = value === "single";
          await this.plugin.saveSettings();
        }));
    const quotePropsSetting = new Setting(formatterEl).setName("对象属性名引号")
      .setDesc('只控制键名，例如 { "name": 1 } 里的 name；不控制属性值，也不影响标准 JSON。')
      .addDropdown(dropdown => dropdown.addOptions({ "as-needed": "仅保留必需引号", consistent: "有属性需引号时统一添加", preserve: "保留已有情况" })
        .setValue(this.plugin.settings.formatQuoteProps ?? "as-needed").onChange(async value => {
          this.plugin.settings.formatQuoteProps = value;
          await this.plugin.saveSettings();
        }));
    details(quotePropsSetting.descEl, "三种选项的区别", [
      '仅保留必需引号："name" 可改为 name，而 "user-name" 等必需的引号仍保留。',
      "有属性需引号时统一添加：同一个对象只要有一个键需要引号，就给其他键也加上。",
      "保留已有情况：不增删键名引号，但引号用单引号还是双引号，仍按“字符串引号偏好”处理。"
    ], '{ "name": 1 }  →  { name: 1 }\n{ "user-name": 1 }  →  保留必需的引号');
    new Setting(formatterEl).setName("对象花括号内空格")
      .setDesc("如对象字面量：开启为 { name: value }，关闭为 {name: value}。不控制函数体的花括号。")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.formatBracketSpacing !== false).onChange(async value => {
        this.plugin.settings.formatBracketSpacing = value;
        await this.plugin.saveSettings();
      }));
    const objectWrapSetting = new Setting(formatterEl).setName("对象换行方式")
      .setDesc("保留多行：{ 后已有换行的对象继续分行。尽量合并：能放进一行就合并。")
      .addDropdown(dropdown => dropdown.addOptions({ preserve: "保留已有多行形式", collapse: "尽量合并为一行" })
        .setValue(this.plugin.settings.formatObjectWrap ?? "preserve").onChange(async value => {
          this.plugin.settings.formatObjectWrap = value;
          await this.plugin.saveSettings();
        }));
    details(objectWrapSetting.descEl, "查看多行与单行示例", ["“保留”以左花括号后是否已有换行为判断依据，不是保留源码中的所有换行。"], '{\n  name: "demo",\n  count: 1\n}\n\n行宽允许时可合并为：\n{ name: "demo", count: 1 }');
    new Setting(formatterEl).setName("标签与内嵌代码").setHeading().settingEl.classList.add("qn-settings-subheading");
    new Setting(formatterEl).setName("标签每行一个属性")
      .setDesc("适用于 HTML、Vue 和 JSX。开启后每行一个属性；关闭允许同行排列，行宽不足时仍可能换行。")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.formatSingleAttributePerLine === true).onChange(async value => {
        this.plugin.settings.formatSingleAttributePerLine = value;
        await this.plugin.saveSettings();
      }));
    const bracketSetting = new Setting(formatterEl).setName("多行标签的 > 位置")
      .setDesc("开始标签分多行时，> 跟随最后一个属性，还是单独一行。不影响 <br /> 这类自闭合标签。")
      .addDropdown(dropdown => dropdown.addOptions({ next: "单独下一行", same: "跟随最后一个属性" })
        .setValue(this.plugin.settings.formatBracketSameLine ? "same" : "next").onChange(async value => {
          this.plugin.settings.formatBracketSameLine = value === "same";
          await this.plugin.saveSettings();
        }));
    details(bracketSetting.descEl, "查看两种位置", [], '<button\n  id="save"\n>\n\n或跟随最后一个属性：\n<button\n  id="save">');
    const whitespaceSetting = new Setting(formatterEl).setName("HTML 标签间空白处理")
      .setDesc("适用于 HTML、Vue。决定格式化时怎样处理标签与文字间的空格、换行。“全部视为无意义”可能改变页面显示。")
      .addDropdown(dropdown => dropdown.addOptions({ css: "按标签默认显示类型", strict: "全部视为有意义", ignore: "全部视为无意义" })
        .setValue(this.plugin.settings.formatHtmlWhitespaceSensitivity ?? "css").onChange(async value => {
          this.plugin.settings.formatHtmlWhitespaceSensitivity = value;
          await this.plugin.saveSettings();
        }));
    details(whitespaceSetting.descEl, "三种空白处理方式", [
      "按标签默认显示类型：按标签通常是行内还是块级元素判断，不读取实际 CSS。",
      "全部视为有意义：将所有标签周围的空白都视为可能影响显示。",
      "全部视为无意义：允许忽略这些空白的显示含义后重新排版；若空格用于分隔文字，结果可能发生变化。"
    ], '<span>hello</span> <span>world</span>\n两段文字之间的空格可能影响显示，不能只把它看成源码排版。');
    const embeddedSetting = new Setting(formatterEl).setName("格式化内嵌代码")
      .setDesc("同时整理 HTML/Vue 的脚本、样式、Vue 插值和可识别模板字符串中的代码。若必须保留字符串里的原始内容，建议关闭。")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.formatEmbedded === true).onChange(async value => {
        this.plugin.settings.formatEmbedded = value;
        await this.plugin.saveSettings();
      }));
    details(embeddedSetting.descEl, "影响范围与关闭后的行为", [
      "开启可能改写字符串中的空白、引号、大小写等，进而改变实际值或运行结果。",
      "关闭后跳过这些内嵌内容的深入整理；外层代码仍会格式化。“Vue 脚本和样式额外缩进”是独立设置。"
    ]);
    new Setting(formatterEl).setName("Vue 脚本和样式额外缩进")
      .setDesc("让 <script> 和 <style> 内部代码整体多缩进一级。不受上一项开关影响。")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.formatVueIndentScriptAndStyle === true).onChange(async value => {
        this.plugin.settings.formatVueIndentScriptAndStyle = value;
        await this.plugin.saveSettings();
      }));
  }
}

module.exports = class CodeBlockEnhancements extends Plugin {
  enhanceLiveCallouts(editorView) {
    if (this.unloaded) return;
    this.liveCalloutBlocks ??= new Set();
    for (const child of this.liveCalloutBlocks) {
      if (!child.code.isConnected) { this.removeChild(child); this.liveCalloutBlocks.delete(child); }
    }
    const candidates = Array.from(editorView.dom.querySelectorAll(".callout pre > code")).filter(code =>
      !code.classList.contains("qn-wrapped-code") && !code.querySelector(".qn-code-line") && !code.closest(".expressive-code,.mermaid,.block-language-dataview"));
    if (!candidates.length) return;
    const owner = this.app.workspace.getLeavesOfType("markdown").find(l => l.view.editor?.cm === editorView);
    if (!owner?.view.file || owner.view.getMode() !== "source") return;
    const source = editorView.state.doc.toString();
    if (source.length > 2000000) return;
    for (const code of candidates) {
      const language = /(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1]?.toLowerCase();
      const value = code.textContent.replace(/\r\n/g, "\n").replace(/\n$/, "");
      const matches = snapshotBlocks(source).filter(b => b.language === language && b.value === value);
      const options = parseOptions(`${language || ""} ${matches.length === 1 ? matches[0].meta : ""}`);
      if (matches.length === 1) { options.sourceLine = matches[0].line - 1; options.sourceSnapshot = source; }
      const child = new WrappedCode(code, this, options, owner.view.file.path);
      child.editorView = editorView;
      this.liveCalloutBlocks.add(child);
      this.addChild(child);
    }
  }

  applyFormatFeedback(button) {
    if (!FORMAT_LANGUAGES.has((button.dataset.qnFormatLanguage || "").toLowerCase())) {
      button.setAttribute("aria-disabled", "true");
      button.dataset.qnFormatState = "unsupported";
      const active = button.dataset.qnFormatHovered === "true" || button.dataset.qnFormatFocused === "true";
      setIcon(button, active ? "ban" : "paintbrush");
      setTooltip(button, "此语言暂不支持格式化");
      return;
    }
    if (this.unloaded) return;
    const feedback = this.formatResult?.target === button ? this.formatResult.result : null;
    const state = feedback?.ok === true ? "success" : feedback ? "error" : "idle";
    button.dataset.qnFormatState = state;
    setIcon(button, state === "success" ? "check" : state === "error" ? "x" : "paintbrush");
    setTooltip(button, "格式化此代码块");
  }

  hideFormatPopup() {
    const current = this.formatResult;
    if (current?.frame) {
      current.target.ownerDocument.defaultView.cancelAnimationFrame(current.frame);
      current.frame = null;
    }
    this.formatResultPopup?.element.remove();
    this.formatResultPopup = null;
  }

  clearFormatFeedback() {
    const current = this.formatResult;
    this.hideFormatPopup();
    this.formatResult = null;
    if (current) clearTimeout(current.timer);
    if (current?.target) this.applyFormatFeedback(current.target);
  }

  showFormatFeedback(result, originalButton) {
    if (!result || this.unloaded) return;
    this.clearFormatFeedback();
    const doc = originalButton.ownerDocument;
    const view = originalButton.qnOwnerView;
    let target = originalButton.isConnected ? originalButton : null;
    // 格式化会重建 DOM；只在原视图中恢复已知源码位置，不按全局行号猜按钮。
    if (!target && view?.file?.path === result.path && Number.isInteger(result.line)) {
      const candidates = Array.from(view.containerEl.querySelectorAll(".qn-format-button")).filter(button =>
        originalButton.qnEditorMode === undefined || !!button.closest(".markdown-source-view") === originalButton.qnEditorMode);
      target = candidates.find(button =>
        button.dataset.qnFormatPath === result.path && button.dataset.qnFormatLine === String(result.line) && button.getBoundingClientRect().width > 0);
      if (!target) {
        const source = view.getMode?.() === "source" ? view.editor.getValue() : view.getViewData();
        const matches = candidates.filter(button => {
          if (button.dataset.qnFormatPath !== result.path) return false;
          if (button.getBoundingClientRect().width <= 0 && !(originalButton.qnCalloutExpanded && button.closest(".callout.is-collapsed"))) return false;
          const code = button.closest("pre")?.querySelector("code");
          if (!code) return false;
          try {
            const mapped = view.getMode?.() === "source" ? resolveLiveCalloutBlock(view.editor.cm, code, source) : resolveReadingBlock(view, code, source);
            return (mapped || resolveRenderedBlock(source, { language: button.dataset.qnFormatLanguage }, code.textContent)).sourceLine === result.line;
          } catch { return false; }
        });
        if (matches.length === 1) target = matches[0];
      }
    }
    if (!target) return;
    const callout = target.closest(".callout");
    if (originalButton.qnCalloutExpanded && callout?.classList.contains("is-collapsed")) callout.querySelector(".callout-title")?.click();
    const Mouse = doc.defaultView.MouseEvent;
    target.dispatchEvent(new Mouse("mouseleave"));
    target.dispatchEvent(new Mouse("mouseout", { bubbles: true }));
    const popup = doc.createElement("div");
    popup.className = "qn-format-result-popup";
    popup.setAttribute("role", "status");
    popup.setAttribute("aria-live", "polite");
    popup.textContent = result.message;
    popup.style.visibility = "hidden";
    doc.body.append(popup);
    const win = doc.defaultView;
    this.formatResultPopup = { element: popup };
    const current = { target, view, result };
    this.formatResult = current;
    this.applyFormatFeedback(target);
    // 默认折叠的 Callout 重建后有展开动画；等待有效几何信息，并跟随布局变化。
    const position = () => {
      if (this.formatResult !== current) return;
      if (!target.isConnected) { this.clearFormatFeedback(); return; }
      const buttonRect = target.getBoundingClientRect(), popupRect = popup.getBoundingClientRect();
      if (buttonRect.width > 0 && buttonRect.height > 0 &&
          [buttonRect.right, buttonRect.top, buttonRect.bottom].every(Number.isFinite)) {
        popup.style.left = `${Math.max(8, Math.min(buttonRect.right - popupRect.width, win.innerWidth - popupRect.width - 8))}px`;
        const preferredTop = buttonRect.bottom + popupRect.height + 8 <= win.innerHeight ? buttonRect.bottom + 6 : buttonRect.top - popupRect.height - 6;
        popup.style.top = `${Math.max(8, Math.min(preferredTop, win.innerHeight - popupRect.height - 8))}px`;
        popup.style.visibility = "visible";
      } else popup.style.visibility = "hidden";
      current.frame = win.requestAnimationFrame(position);
    };
    position();
    current.timer = setTimeout(() => {
      if (this.formatResult === current) this.clearFormatFeedback();
    }, result.ok ? 1000 : 5000);
  }

  async restoreFormattingScroll(view, scroll, filePath, mode) {
    if (!scroll) return;
    const restore = () => {
      if (this.unloaded || view.file?.path !== filePath || view.leaf.view !== view || view.getMode() !== mode) return;
      const element = mode === "preview" ? view.containerEl?.querySelector(".markdown-preview-view") : view.editor.cm?.scrollDOM;
      if (element) { element.scrollTop = scroll.top; element.scrollLeft = scroll.left; }
      else view.editor.scrollTo?.(scroll.left, scroll.top);
    };
    restore();
    await new Promise(resolve => requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(() => { restore(); resolve(); });
    }));
  }

  async formatCodeBlock(view, line, expectedText, snapshot) {
    const feedback = { path: view?.file?.path, line };
    if (this.unloaded) return { ...feedback, ok: false, message: "插件已卸载，格式化已取消。" };
    if (this.formattingBusy) return { ...feedback, ok: false, message: "正在格式化，请稍候。" };
    this.formattingBusy = true;
    try {
      if (!view?.editor || !view.file || !Number.isInteger(line)) throw new Error("无法定位代码块，请重新打开笔记后重试。");
      const filePath = view.file.path;
      const originalState = view.getState();
      const reading = view.getMode?.() === "preview";
      const source = reading ? view.getViewData() : view.editor.getValue();
      if (source.length > 2000000) throw new Error("笔记过大（超过 200 万字符），请先拆分后重试。");
      const { locateCodeBlock, planFormatting, applyChanges } = require("./formatting.js");
      const block = locateCodeBlock(source, line, expectedText, snapshot);
      feedback.line = block.line - 1;
      const result = await planFormatting(source, [{ from: block.from, to: block.from }], {
        printWidth: this.settings.formatWidth, tabWidth: this.settings.formatTabWidth,
        semi: this.settings.formatSemi, singleQuote: this.settings.formatSingleQuote,
        embeddedLanguageFormatting: this.settings.formatEmbedded === true,
        trailingComma: this.settings.formatTrailingComma,
        arrowParens: this.settings.formatArrowParens,
        singleAttributePerLine: this.settings.formatSingleAttributePerLine === true,
        useTabs: this.settings.formatUseTabs === true, bracketSpacing: this.settings.formatBracketSpacing !== false,
        quoteProps: this.settings.formatQuoteProps, jsxSingleQuote: this.settings.formatJsxSingleQuote === true,
        objectWrap: this.settings.formatObjectWrap, bracketSameLine: this.settings.formatBracketSameLine === true,
        vueIndentScriptAndStyle: this.settings.formatVueIndentScriptAndStyle === true,
        htmlWhitespaceSensitivity: this.settings.formatHtmlWhitespaceSensitivity,
        formatManaged: async (text, language) => {
          if (!this.managedFormatters) {
            const { ManagedFormatters } = require("./managed-formatters.js");
            this.managedFormatters = new ManagedFormatters({ adapter: this.app.vault.adapter,
              baseDir: `${this.manifest.dir}/components`, request: requestUrl,
              onStatus: message => this.formatProgress?.(message) });
          }
          return this.managedFormatters.format(text, language, require("./formatting.js").formatClang);
        }
      });
      if (this.unloaded || (reading ? view.getViewData() : view.editor.getValue()) !== source || view.file?.path !== filePath ||
          view.leaf.view !== view || view.getMode() !== originalState.mode) throw new Error("格式化期间笔记或视图发生变化，结果已丢弃，请重试。");
      if (!result.changes.length) return { ...feedback, ok: true, message: "已格式化" };
      const ephemeral = reading ? view.getEphemeralState() : null;
      const scroller = reading ? view.containerEl?.querySelector(".markdown-preview-view") : view.editor.cm?.scrollDOM;
      const scroll = scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : !reading ? view.editor.getScrollInfo?.() : null;
      let restoreSource = source;
      try {
        // 阅读模式的隐藏编辑器不会走保存链路；经正式视图切换激活编辑器事务后再恢复阅读。
        if (reading) await view.leaf.setViewState({ type: "markdown", state: { ...originalState, mode: "source" } });
        const editor = view.editor;
        if (this.unloaded || editor.getValue() !== source || view.file?.path !== filePath || view.leaf.view !== view || view.getMode() !== "source") throw new Error("提交前笔记或视图发生变化，未写入格式化结果。");
        if (editor.cm) editor.cm.dispatch({ changes: result.changes.map(change => ({ from: change.from, to: change.to, insert: change.text })), scrollIntoView: false, annotations: Transaction.userEvent.of("input.format") });
        else editor.transaction({ changes: result.changes.map(change => ({
          from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.text
        })) }, "code-block-enhancements-format");
        restoreSource = applyChanges(source, result.changes);
      } finally {
        if (!this.unloaded && reading && view.file?.path === filePath && view.leaf.view === view && view.getMode() === "source" && view.editor.getValue() === restoreSource) {
          await view.leaf.setViewState({ type: "markdown", state: originalState });
          if (!this.unloaded && view.file?.path === filePath && view.leaf.view === view) {
            const { scroll: _oldLineScroll, ...rest } = ephemeral || {};
            view.setEphemeralState(rest);
          }
        }
      }
      await this.restoreFormattingScroll(view, scroll, filePath, originalState.mode);
      return { ...feedback, ok: true, message: "格式化成功" };
    } catch (error) {
      return { ...feedback, ok: false, message: `格式化失败：${error.message || "未修改源码"}` };
    } finally { this.formattingBusy = false; }
  }
  async onload() {
    this.unloaded = false;
    this.registerDomEvent(document, "pointerdown", event => {
      if (this.formatResult && !this.formatResult.target.contains(event.target)) this.clearFormatFeedback();
    }, true);
    this.registerDomEvent(document, "wheel", () => this.clearFormatFeedback(), { capture: true, passive: true });
    this.registerDomEvent(document, "touchmove", () => this.clearFormatFeedback(), { capture: true, passive: true });
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.revision = 0;
    this.ownedFolds = new Map();
    this.blocks = new Set();
    this.extension = editorWrapping(this);
    this.registerEditorExtension(this.extension);
    this.registerMarkdownPostProcessor((element, context) => {
      for (const code of element.querySelectorAll("pre > code")) {
        if (code.closest(".expressive-code,.mermaid,.block-language-dataview") ||
            code.querySelector(".qn-code-line")) continue;
        const info = context.getSectionInfo(code);
        // 不让缩进代码等非围栏 DOM 消耗围栏序号，语言始终以原生高亮标记为准。
        const options = parseOptions(/(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1]?.toLowerCase() || "");
        if (info) {
          const value = code.textContent.replace(/\r\n/g, "\n").replace(/\n$/, "");
          const matches = snapshotBlocks(info.text).filter(block => block.line - 1 >= info.lineStart && block.line - 1 <= info.lineEnd && block.language === options.language && block.value.replace(/\r\n/g, "\n") === value);
          if (matches.length === 1) options.sourceLine = matches[0].line - 1;
        }
        options.sourceSnapshot = info?.text;
        if (options.sourceLine === undefined) {
          // 实时预览的 Callout 可能没有 SectionInfo；仅接受当前笔记中唯一且逐字相同的原生代码块。
          const owner = this.app.workspace.getLeavesOfType("markdown").find(l => l.view.file?.path === context.sourcePath && l.view.containerEl.contains(code));
          const source = owner?.view.getViewData();
          const language = /(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1]?.toLowerCase();
          if (source !== undefined && language) {
            const value = code.textContent.replace(/\r\n/g, "\n").replace(/\n$/, "");
            const matches = snapshotBlocks(source).filter(b => b.language === language && b.value === value);
            if (matches.length === 1) Object.assign(options, parseOptions(`${matches[0].language} ${matches[0].meta}`), { sourceLine: matches[0].line - 1, sourceSnapshot: source });
          }
        }
        context.addChild(new WrappedCode(code, this, options, context.sourcePath));
      }
    }, 1000);
    this.addSettingTab(new CodeBlockEnhancementsSettings(this.app, this));
    this.app.workspace.onLayoutReady(() => this.enhanceExistingPreviews());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.schedulePreviewEnhancement()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.schedulePreviewEnhancement()));
    this.registerDomEvent(document, "scroll", event => {
      if (event.target?.matches?.(".markdown-preview-view")) this.schedulePreviewEnhancement();
    }, true);
  }

  // 合并同一帧内的高度变化；只重测受影响区段，不重新解析整篇笔记。
  scheduleLayout(code) {
    this.layoutCodes ??= new Set();
    this.layoutCodes.add(code);
    if (this.layoutFrame) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      const codes = [...this.layoutCodes];
      this.layoutCodes.clear();
      if (this.unloaded) return;
      for (const { view } of this.app.workspace.getLeavesOfType("markdown")) {
        const owned = codes.filter(code => code.isConnected && view.containerEl.contains(code));
        if (!owned.length) continue;
        if (view.getMode() === "source") view.editor?.cm?.requestMeasure();
        else {
          // 阅读视图的虚拟滚动缓存区段高度；仅 DOM 折叠不会使其失效。
          const renderer = view.previewMode?.renderer;
          if (renderer?.getSectionForElement && renderer.measureSection && renderer.updateVirtualDisplay) {
            const sections = new Set(owned.map(code => renderer.getSectionForElement(code)).filter(Boolean));
            for (const section of sections) renderer.measureSection(section);
            renderer.updateVirtualDisplay();
          } else view.onResize?.();
        }
      }
    });
  }

  async saveSettings(displaySetting) {
    await this.saveData(this.settings);
    if (displaySetting !== "wrap" && displaySetting !== "folding") return;
    this.revision++;
    if (!this.settings.folding) this.clearEditorFolds();
    for (const block of this.blocks) block.refresh(displaySetting);
    // 空事务通知现有扩展读取 revision，不重新注册整套编辑器扩展。
    for (const { view } of this.app.workspace.getLeavesOfType("markdown")) {
      if (view.getMode?.() === "source") view.editor?.cm?.dispatch({});
    }
  }

  clearEditorFolds() {
    for (const [view, ranges] of this.ownedFolds) {
      const effects = ranges.filter(r => r.from >= 0 && r.to <= view.state.doc.length)
        .map(r => unfoldEffect.of(r));
      if (effects.length) view.dispatch({ effects });
    }
    this.ownedFolds.clear();
  }

  schedulePreviewEnhancement() {
    if (this.unloaded || this.previewFrame) return;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = 0;
      this.enhanceExistingPreviews();
    });
  }

  enhanceExistingPreviews() {
    if (this.unloaded) return;
    this.existingPreviewBlocks ??= new Set();
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const cachedSections = new Set(leaves.flatMap(leaf => leaf.view.previewMode?.renderer?.sections || []));
    for (const block of this.existingPreviewBlocks) {
      if (!block.code.isConnected && !cachedSections.has(block.previewSection)) {
        this.removeChild(block);
        this.existingPreviewBlocks.delete(block);
      }
    }
    // 只增强当前 DOM，不清空原生区段，也不依赖隐藏窗口的全页重绘队列。
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view.getMode?.() !== "preview" || !view.file) continue;
      const candidates = Array.from(view.containerEl.querySelectorAll(".markdown-preview-view pre > code")).filter(code =>
        !code.classList.contains("qn-wrapped-code") && !code.querySelector(".qn-code-line") && !code.closest(".expressive-code,.mermaid,.block-language-dataview"));
      if (!candidates.length) continue;
      const source = view.getViewData();
      for (const code of candidates) {
        const options = parseOptions(/(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1]?.toLowerCase() || "");
        try { Object.assign(options, resolveReadingBlock(view, code, source)); } catch {
          // 无可靠位置时只增强显示；格式化按钮仍会在点击时校验源码位置。
        }
        const child = new WrappedCode(code, this, options, view.file.path);
        child.previewSection = view.previewMode?.renderer?.getSectionForElement?.(code);
        this.addChild(child);
        this.existingPreviewBlocks.add(child);
      }
    }
  }

  onunload() {
    if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
    for (const child of this.existingPreviewBlocks || []) this.removeChild(child);
    this.existingPreviewBlocks?.clear();
    if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame);
    this.layoutCodes?.clear();
    this.clearFormatFeedback();
    this.unloaded = true;
    this.managedFormatters?.dispose();
    this.formatResultPopup?.element.remove();
    this.formatResultPopup = null;
    require("./formatting.js").clearFenceSnapshots();
    for (const child of this.liveCalloutBlocks || []) this.removeChild(child);
    this.liveCalloutBlocks?.clear();
    this.clearEditorFolds();
    for (const block of Array.from(this.blocks)) block.onunload();
  }
};

module.exports.indentColumns = indentColumns;
module.exports.splitHighlightedLines = splitHighlightedLines;
module.exports.parseOptions = parseOptions;
module.exports.sectionOptions = sectionOptions;
