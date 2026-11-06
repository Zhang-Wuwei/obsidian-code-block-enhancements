"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./formatting.js");
const sample = '# Keep\n\n```js\nconst x={a:1};\n```\n\nKeep  spaces\n';
function setup(mode = "source", afterPlan, initial = sample) {
  let value = initial, data = initial, transactions = 0, activeMode = mode;
  const pos = offset => ({ line: initial.slice(0, offset).split("\n").length - 1, ch: offset - (initial.lastIndexOf("\n", offset - 1) + 1) });
  const offset = (text, p) => text.split("\n").slice(0, p.line).reduce((n, s) => n + s.length + 1, 0) + p.ch;
  const editor = {
    getValue: () => value,
    offsetToPos: pos,
    transaction({ changes }) {
      transactions++;
      value = engine.applyChanges(value, changes.map(c => ({ from: offset(value, c.from), to: offset(value, c.to), text: c.text })));
      if (activeMode === "source") data = value;
    }
  };
  const view = {
    file: { path: "test.md" }, editor,
    getState: () => ({ file: view.file.path, mode: activeMode }), getMode: () => activeMode,
    getViewData: () => activeMode === "source" ? value : data,
    getEphemeralState: () => ({ scroll: 3 }), setEphemeralState() {},
  };
  view.leaf = { view, async setViewState({ state }) {
    if (state.mode === "source") value = data;
    else data = value;
    activeMode = state.mode;
  } };
  const context = { module: { exports: {} }, console, setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0),
    require(name) {
      if (name === "obsidian") return { Plugin: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {} };
      if (name === "@codemirror/view") return { WidgetType: class {} };
      if (name === "@codemirror/language") return {};
      if (name === "@codemirror/state") return { Transaction: { userEvent: { of: value => value } } };
      if (name === "./folding.js") return require("./folding.js");
      if (name === "./formatting.js") return { ...engine, async planFormatting(...args) {
        const result = await engine.planFormatting(...args);
        if (afterPlan) afterPlan({ view, setMode: m => { activeMode = m; }, setText: s => { value = s; data = s; } });
        return result;
      } };
      throw new Error(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/main-source.js`, "utf8"), context);
  const plugin = new context.module.exports();
  plugin.ownedFolds = new Map();
  plugin.blocks = new Set();
  plugin.settings = { formatWidth: 100, formatTabWidth: 2, formatSemi: true, formatSingleQuote: false };
  return { plugin, view, transactions: () => transactions, value: () => value, data: () => data };
}
test("source adapter writes one scoped transaction and returns success", async () => {
  const s = setup();
  const result = await s.plugin.formatCodeBlock(s.view, 2);
  assert.equal(result.ok, true);
  assert.equal(s.transactions(), 1);
  assert.equal(s.value(), sample.replace("const x={a:1};", "const x = { a: 1 };"));
  assert.equal(s.plugin.formattingBusy, false);
});

test("managed engines share transactions and discard a stale asynchronous result", async () => {
  const original = "before\n```python\nx=1\n```\nafter\n";
  const s = setup("source", undefined, original);
  s.plugin.managedFormatters = { format: async () => "x = 1\n" };
  assert.equal((await s.plugin.formatCodeBlock(s.view, 1)).ok, true);
  assert.equal(s.value(), original.replace("x=1", "x = 1"));
  assert.equal(s.transactions(), 1);
  const stale = setup("source", ({ setText }) => setText(original + "new edit\n"), original);
  stale.plugin.managedFormatters = { format: async () => "x = 1\n" };
  assert.equal((await stale.plugin.formatCodeBlock(stale.view, 1)).ok, false);
  assert.equal(stale.transactions(), 0);
  assert.equal(stale.value(), original + "new edit\n");
});

test("manual block formatting forwards comma, arrow and attribute preferences to the engine", async () => {
  const js = setup("source", undefined, '```js\nconst f=(x)=>({\n  first:1,\n  second:2\n});\n```');
  Object.assign(js.plugin.settings, { formatTrailingComma: "all", formatArrowParens: "avoid" });
  assert.equal((await js.plugin.formatCodeBlock(js.view, 0)).ok, true);
  assert.match(js.value(), /const f = x =>/);
  assert.match(js.value(), /second: 2,\n/);
  const html = setup("source", undefined, '```html\n<button id="save" class="primary">Save</button>\n```');
  html.plugin.settings.formatSingleAttributePerLine = true;
  assert.equal((await html.plugin.formatCodeBlock(html.view, 0)).ok, true);
  assert.match(html.value(), /<button\n\s+id="save"\n\s+class="primary"/);
});
test("reading adapter activates commit pipeline and restores mode", async () => {
  const s = setup("preview");
  const result = await s.plugin.formatCodeBlock(s.view, 2, "const x={a:1};\n", sample);
  assert.equal(result.ok, true);
  assert.equal(s.view.getMode(), "preview");
  assert.equal(s.data(), sample.replace("const x={a:1};", "const x = { a: 1 };"));
  assert.equal(s.transactions(), 1);
});

test("a user edit during the reading-to-source transition is not forced back to reading", async () => {
  const s = setup('preview');
  const original = s.view.leaf.setViewState;
  let calls = 0;
  s.view.leaf.setViewState = async options => {
    calls++;
    await original(options);
    if (calls === 1) s.view.editor.transaction({ changes: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, text: 'user edit\n' }] });
  };
  const result = await s.plugin.formatCodeBlock(s.view, 2);
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(s.view.getMode(), 'source');
  assert.ok(s.value().startsWith('user edit'));
});
test("async text change discards result without transaction", async () => {
  const s = setup("source", ({ setText }) => setText(sample + "user edit"));
  const result = await s.plugin.formatCodeBlock(s.view, 2);
  assert.equal(result.ok, false);
  assert.equal(s.transactions(), 0);
  assert.ok(s.value().endsWith("user edit"));
});
test("async file change is not overwritten", async () => {
  const s = setup("source", ({ view }) => { view.file = { path: "other.md" }; });
  assert.equal((await s.plugin.formatCodeBlock(s.view, 2)).ok, false);
  assert.equal(s.transactions(), 0);
});
test("async mode change is respected", async () => {
  const s = setup("preview", ({ setMode }) => setMode("source"));
  assert.equal((await s.plugin.formatCodeBlock(s.view, 2)).ok, false);
  assert.equal(s.transactions(), 0);
  assert.equal(s.view.getMode(), "source");
});
test("detached view rejects commit", async () => {
  const s = setup("source", ({ view }) => { view.leaf.view = {}; });
  assert.equal((await s.plugin.formatCodeBlock(s.view, 2)).ok, false);
  assert.equal(s.transactions(), 0);
});
test("stale target returns failure rather than modifying text", async () => {
  const s = setup("preview");
  const result = await s.plugin.formatCodeBlock(s.view, 2, "changed display\n", sample);
  assert.equal(result.ok, false);
  assert.equal(s.transactions(), 0);
  assert.equal(s.view.getMode(), "preview");
});
test("busy request reports failure inline without starting another job", async () => {
  const s = setup();
  s.plugin.formattingBusy = true;
  const result = await s.plugin.formatCodeBlock(s.view, 2);
  assert.equal(result.ok, false);
  assert.equal(s.transactions(), 0);
});
test("unload cancels pending formatting and cannot recreate feedback timers", async () => {
  let s;
  s = setup("source", () => s.plugin.onunload());
  const result = await s.plugin.formatCodeBlock(s.view, 2);
  assert.equal(result.ok, false);
  assert.equal(s.transactions(), 0);
  s.plugin.showFormatFeedback(result, {});
  assert.equal(s.plugin.formatFeedbackTimers?.size || 0, 0);
  assert.equal(s.value(), sample);
});
test("CodeMirror branch uses insert text and restores scroll without losing code", async () => {
  const s = setup();
  const scrollDOM = { scrollTop: 321, scrollLeft: 12 };
  s.view.editor.cm = { scrollDOM, dispatch(spec) {
    assert.equal(spec.scrollIntoView, false);
    assert.equal(typeof spec.changes[0].insert, "string");
    assert.ok(spec.changes[0].insert.includes("const x ="));
    s.view.editor.transaction({ changes: spec.changes.map(c => ({ from: s.view.editor.offsetToPos(c.from), to: s.view.editor.offsetToPos(c.to), text: c.insert })) });
    scrollDOM.scrollTop = 0;
  } };
  const result = await s.plugin.formatCodeBlock(s.view, 2);
  assert.equal(result.ok, true);
  assert.equal(result.message, "格式化成功");
  assert.equal(s.value(), sample.replace("const x={a:1};", "const x = { a: 1 };"));
  assert.equal(scrollDOM.scrollTop, 321);
  assert.equal(scrollDOM.scrollLeft, 12);
  assert.equal((await s.plugin.formatCodeBlock(s.view, 2)).message, "已格式化");
});
