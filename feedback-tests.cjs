"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

function setup(t) {
  const { document, window } = parseHTML("<html><body></body></html>");
  window.MouseEvent = window.Event;
  window.HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  window.innerWidth = 1000; window.innerHeight = 800;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40 });
  const timers = new Set();
  const frames = new Map(); let frameId = 0;
  window.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const frame = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); };
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  class Setting {
    constructor(container) {
      this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item';
      this.nameEl = document.createElement('div'); this.descEl = document.createElement('div');
      this.nameEl.className = 'setting-item-name'; this.descEl.className = 'setting-item-description';
      this.settingEl.append(this.nameEl, this.descEl); container.append(this.settingEl);
    }
    setName(text) { this.nameEl.textContent = text; return this; }
    setDesc(value) { this.descEl.replaceChildren(value); return this; }
    setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
    addToggle(fn) { const c = { setValue() { return c; }, onChange() { return c; } }; fn(c); return this; }
    addDropdown(fn) {
      const select = document.createElement('select'); this.settingEl.append(select);
      const c = {
        addOptions(options) { for (const [value, label] of Object.entries(options)) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); } return c; },
        setValue(value) { select.setAttribute('data-value', value); return c; },
        onChange(callback) { select.changeValue = callback; return c; }
      };
      fn(c); return this;
    }
    addText(fn) {
      const inputEl = document.createElement('input'); this.settingEl.append(inputEl);
      const c = { inputEl, setValue(v) { inputEl.value = v; return c; }, onChange(fn) { inputEl.changeValue = fn; return c; } };
      fn(c); return this;
    }
  }
  const context = { module: { exports: {} }, console, document, window,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    setTimeout(fn, delay) { const timer = setTimeout(fn, delay); timers.add(timer); return timer; }, clearTimeout,
    require(name) {
      if (name === "obsidian") return { Plugin: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {}, Setting,
        setIcon(button, icon) { button.dataset.icon = icon; }, setTooltip(button, text) { button.dataset.tooltip = text; } };
      if (name === "@codemirror/view") return { WidgetType: class {}, ViewPlugin: { fromClass: C => C } };
      if (name.startsWith("@codemirror/")) return {};
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/main-source.js`, "utf8") + "\nmodule.exports.Settings = CodeBlockEnhancementsSettings; module.exports.formatButton = formatButton; module.exports.WrappedCode = WrappedCode; module.exports.resolveRenderedBlock = resolveRenderedBlock; module.exports.resolveLiveCalloutBlock = typeof resolveLiveCalloutBlock === 'function' ? resolveLiveCalloutBlock : undefined; module.exports.resolveReadingBlock = typeof resolveReadingBlock === 'function' ? resolveReadingBlock : undefined;", context);
  const Plugin = context.module.exports, plugin = new Plugin();
  const view = { containerEl: document.body, file: { path: "test.md" } };
  plugin.app = { workspace: { getLeavesOfType: () => [{ view }] } };
  document.body.getBoundingClientRect = () => ({ width: 200, height: 40 });
  const create = (left, line, run = async () => ({ ok: false, message: "不能定位目标" })) => {
    const button = Plugin.formatButton(document, "js", run, plugin, "test.md", line);
    button.getBoundingClientRect = () => ({ left, right: left + 30, top: 100, bottom: 130, width: 30, height: 30 });
    button.qnOwnerView = view;
    document.body.append(button);
    return button;
  };
  return { Plugin, plugin, document, window, create, view, frame, frames };
}

test("format buttons share the native copy appearance while retaining their own action", async t => {
  const { create, window } = setup(t);
  let calls = 0;
  const button = create(0, 0, async () => { calls++; return { ok: true, message: "已格式化" }; });
  assert.ok(button.classList.contains("copy-code-button"));
  button.dispatchEvent(new window.Event("click"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal(button.dataset.qnFormatState, "success");
});

test("plugin unload completes after sharing the fence snapshot cache", t => {
  const { plugin } = setup(t);
  plugin.blocks = new Set();
  plugin.clearEditorFolds = () => {};
  assert.doesNotThrow(() => plugin.onunload());
  assert.equal(plugin.unloaded, true);
});

test("new installations enable semicolons and embedded formatting, retaining saved preferences", async t => {
  for (const saved of [null, { formatEmbedded: false, formatSemi: false, formatSingleQuote: true, formatTrailingComma: "none", formatArrowParens: "avoid", formatSingleAttributePerLine: true }]) {
    const { plugin } = setup(t);
    plugin.loadData = async () => saved;
    plugin.registerDomEvent = plugin.registerEditorExtension = plugin.registerMarkdownPostProcessor = plugin.addSettingTab = plugin.registerEvent = () => {};
    plugin.app.workspace.onLayoutReady = plugin.app.workspace.on = () => {};
    await plugin.onload();
    assert.equal(plugin.settings.formatSemi, saved?.formatSemi ?? true);
    assert.equal(plugin.settings.formatSingleQuote, saved?.formatSingleQuote ?? false);
    assert.equal(plugin.settings.formatEmbedded, saved?.formatEmbedded ?? true);
    assert.equal(plugin.settings.formatTrailingComma, saved?.formatTrailingComma ?? "all");
    assert.equal(plugin.settings.formatArrowParens, saved?.formatArrowParens ?? "always");
    assert.equal(plugin.settings.formatSingleAttributePerLine, saved?.formatSingleAttributePerLine ?? false);
    assert.equal(plugin.settings.formatUseTabs, false);
    assert.equal(plugin.settings.formatBracketSpacing, true);
    assert.equal(plugin.settings.formatQuoteProps, "as-needed");
    assert.equal(plugin.settings.formatJsxSingleQuote, false);
    assert.equal(plugin.settings.formatObjectWrap, "preserve");
    assert.equal(plugin.settings.formatBracketSameLine, false);
    assert.equal(plugin.settings.formatVueIndentScriptAndStyle, false);
    assert.equal(plugin.settings.formatHtmlWhitespaceSensitivity, "css");
  }
});

test("settings use separate display and formatting groups without changing saved values", t => {
  const { Plugin, plugin, document } = setup(t);
  plugin.manifest = { name: 'Code Block Enhancements' };
  plugin.settings = { wrap: true, folding: true, formatWidth: 100, formatTabWidth: 2, formatSemi: true, formatSingleQuote: false, formatEmbedded: false };
  const before = JSON.stringify(plugin.settings);
  const tab = Object.assign(Object.create(Plugin.Settings.prototype), { plugin, containerEl: document.body });
  tab.display();
  const headings = [...document.querySelectorAll('.setting-item-heading')].map(x => x.textContent);
  assert.ok(headings.some(x => x.startsWith('代码块显示')));
  assert.ok(headings.some(x => x.startsWith('代码块格式化')));
  const formatter = document.querySelector('.qn-settings-formatter[aria-labelledby="qn-prettier-heading"]');
  assert.ok(formatter);
  assert.equal(formatter.hasAttribute('aria-label'), false);
  assert.equal(document.getElementById('qn-prettier-heading').textContent, 'Prettier 格式化偏好');
  assert.equal(formatter.querySelectorAll('.setting-item:not(.setting-item-heading)').length, 16);
  assert.equal(JSON.stringify(plugin.settings), before);
  assert.match(formatter.textContent, /字符串引号偏好/);
  assert.match(formatter.textContent, /格式化内嵌代码/);
});

test("settings explain language ownership before preferences and keep advanced explanations expandable", t => {
  const { Plugin, plugin, document } = setup(t);
  plugin.manifest = { name: 'Code Block Enhancements' };
  plugin.settings = { wrap: true, folding: true, formatWidth: 100, formatTabWidth: 2, formatEmbedded: false, formatTrailingComma: "none", formatBracketSameLine: true };
  const before = JSON.stringify(plugin.settings);
  Object.assign(Object.create(Plugin.Settings.prototype), { plugin, containerEl: document.body }).display();
  const overview = document.querySelector('.qn-formatter-overview');
  assert.ok(overview);
  const rows = [...overview.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 3);
  assert.match(rows.find(r => r.querySelector('th')?.textContent.includes('Java')).textContent, /Prettier（含 Java 扩展）/);
  assert.ok(overview.closest('.qn-formatter-overview-card')?.querySelector('.qn-formatter-download'));
  assert.match(rows.find(r => r.querySelector('th')?.textContent === 'Python').textContent, /Black.*固定风格/);
  assert.match(rows.find(r => r.querySelector('th')?.textContent === 'C\/C\+\+').textContent, /clang-format.*固定风格/);
  assert.ok(document.body.textContent.indexOf('Prettier Java') < document.body.textContent.indexOf('参考行宽'));
  assert.equal(document.querySelectorAll('.setting-item:not(.setting-item-heading)').length, 18);
  const details = [...document.querySelectorAll('details.qn-settings-details')];
  assert.ok(details.length >= 4);
  assert.ok(details.every(d => !d.hasAttribute('open')));
  assert.ok(details.every(d => d.querySelector(':scope > summary') && d.querySelector(':scope > .qn-settings-details-body')));
  assert.match(details.find(d => /支持的语言/.test(d.querySelector('summary').textContent)).textContent, /Java.*SQL.*PHP/);
  assert.match(document.getElementById('qn-prettier-heading').parentElement.textContent, /不影响 Python 和 C\/C\+\+/);
  assert.equal(JSON.stringify(plugin.settings), before);
});

test("quote preference dropdown preserves the stored boolean setting in both directions", async t => {
  const { Plugin, plugin, document } = setup(t);
  plugin.manifest = { name: 'Code Block Enhancements' };
  plugin.settings = { formatSingleQuote: false };
  let saves = 0; plugin.saveSettings = async () => { saves++; };
  const tab = Object.assign(Object.create(Plugin.Settings.prototype), { plugin, containerEl: document.body });
  tab.display();
  const row = [...document.querySelectorAll('.setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent === '字符串引号偏好');
  const select = row?.querySelector('select');
  assert.ok(select);
  assert.equal(select.getAttribute('data-value'), 'double');
  await select.changeValue('single');
  assert.equal(plugin.settings.formatSingleQuote, true);
  await select.changeValue('double');
  assert.equal(plugin.settings.formatSingleQuote, false);
  assert.equal(saves, 2);
});

test("already enhanced Callout and reading blocks do not request the complete source", t => {
  const { plugin, view, document } = setup(t);
  document.body.innerHTML = '<div class="markdown-preview-view"><pre><code class="qn-wrapped-code language-js"><span class="qn-code-line">const x=1;</span></code></pre></div>';
  view.getMode = () => 'preview';
  view.getViewData = () => assert.fail('unnecessary reading source request');
  plugin.enhanceExistingPreviews();
  document.body.innerHTML = '<div class="callout"><pre><code class="qn-wrapped-code"><span class="qn-code-line">x=1</span></code></pre></div>';
  const editorView = { dom: document.body, state: { doc: { toString: () => assert.fail('unnecessary editor source request') } } };
  view.getMode = () => 'source'; view.editor = { cm: editorView };
  plugin.enhanceLiveCallouts(editorView);
});

test("enhancing existing previews never clears native sections or queues a full rerender", t => {
  const { plugin, document, view } = setup(t);
  document.body.innerHTML = '<div class="markdown-preview-view"><p>keep prose</p><pre><code class="language-js">const x=1;\n</code></pre></div>';
  view.getMode = () => "preview";
  view.getViewData = () => 'paragraph\n\n```js\nconst x=1;\n```\n';
  view.previewMode = { rerender: () => assert.fail("native rerender destroys existing preview"), renderer: { queued: { high: true }, sections: [] } };
  const children = [];
  plugin.addChild = child => { children.push(child); child.code.classList.add("qn-wrapped-code"); };
  plugin.enhanceExistingPreviews();
  plugin.enhanceExistingPreviews();
  assert.equal(children.length, 1);
  assert.equal(children[0].sourcePath, "test.md");
  assert.equal(document.querySelector('p').textContent, "keep prose");
  assert.equal(view.previewMode.renderer.queued.high, true);
});

test("offscreen cached preview blocks retain folds until their native section is discarded", t => {
  const { plugin, document, view } = setup(t);
  const section = { el: document.createElement("div") };
  const code = document.createElement("code"); section.el.append(code);
  const block = { code, previewSection: section, collapsedRegions: new Set([2]) };
  view.getMode = () => "preview"; view.getViewData = () => "";
  view.previewMode = { renderer: { sections: [section] } };
  plugin.existingPreviewBlocks = new Set([block]);
  let removed = 0; plugin.removeChild = () => { removed++; };
  plugin.enhanceExistingPreviews();
  assert.equal(removed, 0);
  assert.ok(block.collapsedRegions.has(2));
  view.previewMode.renderer.sections = [];
  plugin.enhanceExistingPreviews();
  assert.equal(removed, 1);
  assert.equal(plugin.existingPreviewBlocks.size, 0);
});

test("width setting reports invalid input, keeps persisted value and restores it on blur", async t => {
  const { Plugin, plugin, document, window } = setup(t);
  plugin.manifest = { name: 'Code Block Enhancements' };
  plugin.settings = { formatWidth: 100 }; let saves = 0;
  plugin.saveSettings = async () => { saves++; };
  Object.assign(Object.create(Plugin.Settings.prototype), { plugin, containerEl: document.body }).display();
  const input = document.querySelector('input');
  assert.equal(input.type, 'number');
  assert.equal(input.min, '40'); assert.equal(input.max, '200');
  for (const value of ['', '30', '201', '80.5', 'abc']) {
    input.value = value; await input.changeValue(value);
    assert.equal(plugin.settings.formatWidth, 100);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(document.querySelector('.qn-setting-error').hidden, false);
  }
  assert.equal(saves, 0);
  input.dispatchEvent(new window.Event('blur'));
  assert.equal(input.value, '100');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  input.value = '80'; await input.changeValue('80');
  assert.equal(plugin.settings.formatWidth, 80); assert.equal(saves, 1);
});

test("feedback waits for Callout layout, tracks expansion and cancels on dismissal", t => {
  const { plugin, create, document, frame, frames } = setup(t);
  const button = create(400, 2);
  let rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  button.getBoundingClientRect = () => rect;
  plugin.showFormatFeedback({ ok: true, message: "格式化成功" }, button);
  const popup = document.querySelector(".qn-format-result-popup");
  assert.equal(popup.style.visibility, "hidden");
  frame();
  assert.equal(popup.style.visibility, "hidden");
  rect = { left: 400, right: 430, top: 300, bottom: 330, width: 30, height: 30 };
  frame();
  assert.equal(popup.style.visibility, "visible");
  assert.equal(popup.style.left, "230px");
  assert.equal(popup.style.top, "336px");
  rect = { ...rect, top: 360, bottom: 390 };
  frame();
  assert.equal(popup.style.top, "396px");
  plugin.clearFormatFeedback();
  assert.equal(frames.size, 0);
  assert.equal(popup.isConnected, false);
});

test("loading icon is delayed so fast formatting does not flash a spinner", async t => {
  const { create, window } = setup(t);
  const fast = create(0, 1, async () => ({ ok: true, message: "格式化成功" }));
  fast.dispatchEvent(new window.Event("click"));
  assert.equal(fast.dataset.icon, "paintbrush");
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(fast.dataset.icon, "loader-circle");
  let finish;
  const slow = create(0, 2, () => new Promise(resolve => { finish = resolve; }));
  slow.dispatchEvent(new window.Event("click"));
  assert.equal(slow.dataset.icon, "paintbrush");
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(slow.dataset.icon, "loader-circle");
  finish({ ok: true, message: "格式化成功" });
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(slow.dataset.icon, "loader-circle");
});

test("format buttons use a whitelist and unsupported languages never run formatting", async t => {
  const { Plugin, plugin, document, window } = setup(t);
  for (const language of ["powershell", "text", "", "unknown", "rust"]) {
    let calls = 0;
    const button = Plugin.formatButton(document, language, async () => { calls++; }, plugin);
    assert.equal(button.dataset.icon, "paintbrush", language);
    assert.equal(button.getAttribute("aria-disabled"), "true", language);
    assert.equal(button.dataset.tooltip, "此语言暂不支持格式化", language);
    button.dispatchEvent(new window.Event("click"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0, language);
    plugin.applyFormatFeedback(button);
    assert.equal(button.dataset.icon, "paintbrush", language);
    button.dispatchEvent(new window.Event("mouseenter"));
    assert.equal(button.dataset.icon, "ban", language);
    button.dispatchEvent(new window.Event("mouseleave"));
    assert.equal(button.dataset.icon, "paintbrush", language);
    button.dispatchEvent(new window.Event("focus"));
    assert.equal(button.dataset.icon, "ban", language);
    button.dispatchEvent(new window.Event("mouseenter"));
    button.dispatchEvent(new window.Event("mouseleave"));
    assert.equal(button.dataset.icon, "ban", language);
    button.dispatchEvent(new window.Event("blur"));
    assert.equal(button.dataset.icon, "paintbrush", language);
  }
  for (const language of ["js", "JS", "vue", "scss", "less", "yaml", "gql"]) {
    const button = Plugin.formatButton(document, language, async () => {}, plugin);
    assert.equal(button.dataset.icon, "paintbrush", language);
    assert.equal(button.getAttribute("aria-disabled"), null, language);
  }
});

test("saving formatting options does not rebuild code or rerender notes", async t => {
  const { plugin } = setup(t);
  plugin.settings = { folding: true };
  plugin.saveData = async () => {};
  plugin.blocks = new Set([{ refresh() { assert.fail("unrelated refresh"); } }]);
  plugin.app.workspace.updateOptions = () => assert.fail("global editor rebuild");
  plugin.rerender = () => assert.fail("whole note rerender");
  await plugin.saveSettings();
});

test("display settings update existing rows without reconstructing highlighted content", t => {
  const { Plugin, plugin, document } = setup(t);
  plugin.settings = { wrap: false, folding: true };
  plugin.scheduleLayout = () => {};
  const code = document.createElement("code"), row = document.createElement("span");
  row.className = "qn-code-line";
  row.style.setProperty("--qn-source-indent", "4ch");
  const token = document.createElement("span"); token.textContent = "const x = 1;";
  row.append(token); code.append(row); document.body.append(code);
  const block = Object.assign(Object.create(Plugin.WrappedCode.prototype), {
    code, plugin, options: { language: "js" }, observer: { disconnect() {} },
    observe() {}, applyFolds() { assert.fail("wrap should not rebuild folds"); },
    restore() { assert.fail("restore destroys existing DOM"); }, render() { assert.fail("full render"); }
  });
  block.refresh("wrap");
  assert.equal(row.firstChild, token);
  assert.equal(row.style.getPropertyValue("--qn-indent"), "0ch");
});

test("layout changes are batched and remeasure only their reading sections", t => {
  const { plugin, document, view, frame, frames } = setup(t);
  const code = document.createElement("code"); document.body.append(code);
  const section = {}; let measures = 0, updates = 0;
  view.getMode = () => "preview";
  view.previewMode = { renderer: {
    getSectionForElement: () => section,
    measureSection(s) { assert.equal(s, section); measures++; },
    updateVirtualDisplay() { updates++; }
  } };
  plugin.scheduleLayout(code); plugin.scheduleLayout(code);
  assert.equal(frames.size, 1);
  frame();
  assert.equal(measures, 1);
  assert.equal(updates, 1);
});

test("duplicate Callouts resolve by current container position, not content or titles", t => {
  const { Plugin, document } = setup(t);
  const quote = '> [!note]+ same\n>\n> ```js\n> const x={a:1};\n> ```\n';
  const source = quote + '\nprose\n\n' + quote;
  const callouts = [0, source.lastIndexOf('> [!note]')].map(pos => {
    const root = document.createElement('div'); root.className = 'callout';
    root.innerHTML = '<pre><code class="language-js">const x={a:1};\n</code></pre>';
    root.sourcePos = pos; document.body.append(root); return root;
  });
  const cm = { dom: document.body, state: { doc: { toString: () => source } }, posAtDOM: root => root.sourcePos };
  const first = Plugin.resolveLiveCalloutBlock(cm, callouts[0].querySelector('code'), source);
  const second = Plugin.resolveLiveCalloutBlock(cm, callouts[1].querySelector('code'), source);
  assert.equal(first.sourceLine, 2);
  assert.equal(second.sourceLine, 10);
  assert.equal(second.sourceSnapshot, source);
});

test("duplicate blocks inside a nested list Callout require a complete ordered DOM match", t => {
  const { Plugin, document } = setup(t);
  const source = '- item\n\n  > [!note] outer\n  >\n  > ```javascript\n  > const x=1;\n  > ```\n  >\n  > > [!tip] nested\n  > >\n  > > ```js\n  > > const x=1;\n  > > ```\n';
  const root = document.createElement('div'); root.className = 'callout';
  root.innerHTML = '<pre><code class="language-javascript">const x=1;\n</code></pre><div class="callout"><pre><code class="language-js">const x=1;\n</code></pre></div>';
  document.body.append(root);
  const cm = { dom: document.body, state: { doc: { toString: () => source } }, posAtDOM: node => { assert.equal(node, root); return source.indexOf('  >'); } };
  const codes = root.querySelectorAll('code');
  assert.equal(Plugin.resolveLiveCalloutBlock(cm, codes[1], source).sourceLine, 10);
  codes[0].textContent = 'stale display';
  assert.throws(() => Plugin.resolveLiveCalloutBlock(cm, codes[1], source), /源码|显示/);
  codes[0].remove();
  assert.throws(() => Plugin.resolveLiveCalloutBlock(cm, codes[1], source), /源码|显示/);
});

test("reading mode resolves the current section rather than a recycled button line", t => {
  const { Plugin, document, view } = setup(t);
  const quote = '> [!note]\n>\n> ```js\n> const x=1;\n> ```\n';
  const source = quote + '\n' + quote;
  const root = document.createElement('div');
  root.innerHTML = '<pre><code class="language-js">const x=1;\n</code></pre>';
  document.body.append(root);
  const code = root.querySelector('code');
  view.previewMode = { renderer: {
    getSectionInfo: () => ({ text: source, lineStart: 6, lineEnd: 10 }),
    getSectionForElement: () => ({ el: root })
  } };
  assert.equal(Plugin.resolveReadingBlock(view, code, source).sourceLine, 8);
  assert.throws(() => Plugin.resolveReadingBlock(view, code, source + '\nchanged'), /源码|显示/);
});

test("an indented code block in the same section does not shift the fenced block target", t => {
  const { Plugin, document, view } = setup(t);
  const source = '> [!note]\n>\n>     raw text\n>\n> ```js\n> const x=1;\n> ```\n';
  const root = document.createElement('div');
  root.innerHTML = '<pre><code>raw text\n</code></pre><pre><code class="language-js">const x=1;\n</code></pre>';
  document.body.append(root);
  view.previewMode = { renderer: { getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: 7 }), getSectionForElement: () => ({ el: root }) } };
  assert.equal(Plugin.resolveReadingBlock(view, root.querySelector('.language-js'), source).sourceLine, 4);
  assert.throws(() => Plugin.resolveReadingBlock(view, root.querySelector('code'), source), /源码|显示/);
});

test("unlocated Callout feedback belongs only to the clicked button and replaces the old result", t => {
  const { plugin, create, document } = setup(t);
  const first = create(200), second = create(600);
  plugin.showFormatFeedback({ ok: false, message: "第一个" }, first);
  assert.equal(first.dataset.qnFormatState, "error");
  assert.equal(second.dataset.qnFormatState, "idle");
  plugin.showFormatFeedback({ ok: false, message: "第二个" }, second);
  assert.equal(first.dataset.qnFormatState, "idle");
  assert.equal(second.dataset.qnFormatState, "error");
  assert.equal(document.querySelectorAll(".qn-format-result-popup").length, 1);
  assert.equal(document.querySelector(".qn-format-result-popup").textContent, "第二个");
});

test("leaving the feedback button dismisses the popup and resets its icon", t => {
  const { plugin, create, document, window } = setup(t);
  const button = create(200, 10);
  plugin.showFormatFeedback({ ok: false, message: "错误", path: "test.md", line: 10 }, button);
  button.dispatchEvent(new window.Event("mouseleave"));
  assert.equal(document.querySelector(".qn-format-result-popup"), null);
  assert.equal(button.dataset.icon, "paintbrush");
});

test("success check survives mouseleave and blur until its timeout, without a popup or layout loop", async t => {
  const { plugin, create, document, window, frames } = setup(t);
  const button = create(200, 10);
  plugin.showFormatFeedback({ ok: true, message: "格式化成功" }, button);
  button.dispatchEvent(new window.Event("mouseleave"));
  button.dispatchEvent(new window.Event("blur"));
  assert.equal(document.querySelector(".qn-format-result-popup"), null);
  assert.equal(button.dataset.icon, "check");
  assert.equal(frames.size, 0);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(button.dataset.icon, "check");
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(button.dataset.icon, "paintbrush");
  assert.equal(plugin.formatResult, null);
});

test("a duplicate block in another view never inherits the clicked button feedback", t => {
  const { plugin, create } = setup(t);
  const first = create(200, 10), second = create(600, 10);
  plugin.showFormatFeedback({ ok: false, message: "错误", path: "test.md", line: 10 }, second);
  assert.equal(first.dataset.qnFormatState, "idle");
  assert.equal(second.dataset.qnFormatState, "error");
});

test("rendered Callouts resolve a unique matching source at click time, refusing duplicates", t => {
  const { Plugin } = setup(t);
  const source = '> [!note]\n>\n> ```js\n> const x={a:1};\n> ```\n';
  const target = Plugin.resolveRenderedBlock(source, { language: "js" }, "const x={a:1};\n");
  assert.equal(target.sourceLine, 2);
  assert.equal(target.sourceSnapshot, source);
  assert.throws(() => Plugin.resolveRenderedBlock(source + "\n" + source, { language: "js" }, "const x={a:1};\n"), /多处相同/);
});

test("a slow earlier click cannot replace the latest button result", async t => {
  const { plugin, create, document, window } = setup(t);
  let finish;
  const first = create(200, 10, () => new Promise(resolve => { finish = resolve; }));
  const second = create(600, 20, async () => ({ ok: false, message: "最新结果" }));
  first.dispatchEvent(new window.Event("click"));
  second.dispatchEvent(new window.Event("click"));
  await new Promise(resolve => setImmediate(resolve));
  finish({ ok: true, message: "旧结果" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.querySelector(".qn-format-result-popup").textContent, "最新结果");
  assert.equal(plugin.formatResult.target, second);
});

test("a re-rendered unique Callout regains feedback even before its source line is attached", t => {
  const { plugin, create, document, view } = setup(t);
  const old = create(200, 2);
  old.remove();
  view.getViewData = () => '> [!note]\n>\n> ```js\n> const x = { a: 1 };\n> ```\n';
  const replacement = create(200);
  const pre = document.createElement("pre"), code = document.createElement("code");
  code.textContent = "const x = { a: 1 };\n";
  pre.append(replacement, code); document.body.append(pre);
  plugin.showFormatFeedback({ ok: true, message: "格式化成功", path: "test.md", line: 2 }, old);
  assert.equal(replacement.dataset.qnFormatState, "success");
  assert.equal(document.querySelector(".qn-format-result-popup")?.textContent, "格式化成功");
});

test("formatting preserves a manually expanded default-collapsed Callout before showing feedback", t => {
  const { plugin, create, document, view } = setup(t);
  const old = create(200, 2); old.qnCalloutExpanded = true; old.remove();
  view.getViewData = () => '> [!tip]- CSS\n>\n> ```js\n> const x = { a: 1 };\n> ```\n';
  const replacement = create(200);
  const callout = document.createElement("div"); callout.className = "callout is-collapsed";
  const title = document.createElement("div"); title.className = "callout-title";
  title.addEventListener("click", () => callout.classList.remove("is-collapsed"));
  const pre = document.createElement("pre"), code = document.createElement("code");
  code.textContent = "const x = { a: 1 };\n";
  replacement.getBoundingClientRect = () => ({ left: 200, right: 230, top: 100, bottom: 130, width: callout.classList.contains("is-collapsed") ? 0 : 30, height: 30 });
  pre.append(replacement, code); callout.append(title, pre); document.body.append(callout);
  plugin.showFormatFeedback({ ok: true, message: "格式化成功", path: "test.md", line: 2 }, old);
  assert.equal(callout.classList.contains("is-collapsed"), false);
  assert.equal(replacement.dataset.qnFormatState, "success");
});

test("rendered fold controls cancel pointer selection and do not bubble to the Callout editor", t => {
  const { Plugin, document, window } = setup(t);
  const callout = document.createElement("div"), code = document.createElement("code");
  document.body.append(callout); callout.append(code);
  const texts = ["function x() {", "  return 1;", "}"];
  const lines = texts.map(text => { const content = document.createDocumentFragment(); content.append(text); return { text, content }; });
  for (const text of texts) { const row = document.createElement("span"); row.className = "qn-code-line"; row.textContent = text; code.append(row); }
  const wrapper = Object.assign(Object.create(Plugin.WrappedCode.prototype), { code, lines, regions: [{ from: 14, to: 25, startLine: 0, endLine: 2, startColumn: 14, endColumn: 0 }], collapsedRegions: new Set() });
  let toggled = 0, leaked = 0;
  wrapper.toggleRegion = () => { toggled++; };
  wrapper.applyFolds();
  for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "click", "dblclick"]) callout.addEventListener(type, () => { leaked++; });
  const button = code.querySelector(".qn-fold-toggle");
  for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "click", "dblclick"]) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, type);
  }
  assert.equal(toggled, 1);
  assert.equal(leaked, 0);
});
