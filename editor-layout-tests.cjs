"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { foldRegions } = require("./folding.js");
const { parseHTML } = require("linkedom");

function incrementalHarness() {
  const counts = { markdown: 0, folds: 0 };
  const sandbox = { module: { exports: {} }, require(name) {
    if (name === "obsidian") return { Plugin: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {} };
    if (name === "@codemirror/view") return { WidgetType: class {} };
    if (name === "@codemirror/state") return {};
    if (name === "@codemirror/language") return { syntaxTree: () => ({ iterate() {} }) };
    if (name === "./folding.js") return { foldRegions(...args) { counts.folds++; return foldRegions(...args); } };
    if (name === "./formatting.js") return { ...require(name), findCodeBlocks(source) { counts.markdown++; return require(name).findCodeBlocks(source); } };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/main-source.js`, "utf8") + "\nmodule.exports.editorBlocks=editorBlocks; module.exports.remapEditorBlocks=remapEditorBlocks;", sandbox);
  return { ...sandbox.module.exports, counts };
}

test("ordinary prose and IME replacements remap code ranges without reparsing Markdown or languages", () => {
  const { EditorState } = require("@codemirror/state"), h = incrementalHarness();
  let state = EditorState.create({ doc: '中文正文\n\n```js\nfunction run() {\n  return 1;\n}\n```\n\n> ```python\n> def run():\n>   return 1\n> ```\n\n尾部正文' });
  let blocks = h.editorBlocks(state);
  assert.equal(blocks.length, 2);
  const before = { ...h.counts };
  for (const change of [{ from: 2, insert: 'zhong' }, { from: 2, to: 7, insert: '中' }, { from: 2, to: 3, insert: '' }]) {
    const tr = state.update({ changes: change });
    blocks = h.remapEditorBlocks(blocks, { startState: state, state: tr.state, changes: tr.changes });
    assert.ok(blocks);
    for (const b of blocks) {
      assert.match(tr.state.doc.lineAt(b.open.from).text, /```/);
      for (const r of b.regions) assert.ok(r.from < r.to && r.to <= b.close.from);
    }
    state = tr.state;
  }
  assert.deepEqual(h.counts, before);
});

test("code edits refresh only their own fold ranges; structural edits refuse the fast path", () => {
  const { EditorState } = require("@codemirror/state"), h = incrementalHarness();
  const state = EditorState.create({ doc: '中文正文\n\n```js\nfunction run() {\n  return 1;\n}\n```\n\n```python\ndef run():\n  return 1\n```' });
  const blocks = h.editorBlocks(state), before = { ...h.counts }, pos = state.doc.toString().indexOf('return 1');
  const tr = state.update({ changes: { from: pos + 7, to: pos + 8, insert: '2' } });
  const mapped = h.remapEditorBlocks(blocks, { startState: state, state: tr.state, changes: tr.changes });
  assert.ok(mapped);
  assert.equal(h.counts.markdown, before.markdown);
  assert.equal(h.counts.folds, before.folds + 1);
  for (const change of [{ from: 2, insert: '\n' }, { from: blocks[0].open.from, insert: '~' }, { from: pos, insert: '```' }, { from: 0, to: 4, insert: '>[!note]' }]) {
    const t = state.update({ changes: change });
    assert.equal(h.remapEditorBlocks(blocks, { startState: state, state: t.state, changes: t.changes }), null);
  }
});

test("incremental results match a fresh index, including multi-edits, lists and quoted code", () => {
  const { EditorState } = require("@codemirror/state"), h = incrementalHarness();
  let state = EditorState.create({ doc: '中文正文\n\n- item\n\n  ```js\n  function f() {\n    return 1;\n  }\n  ```\n\n> > ```python\n> > def f():\n> >   return 1\n> > ```\n\n最后正文' });
  let blocks = h.editorBlocks(state);
  for (let i = 0; i < 30; i++) {
    const text = state.doc.toString(), pos = text.indexOf(i % 2 ? 'return 1' : '中文正文');
    const tr = state.update({ changes: [{ from: pos + 2, insert: i % 2 ? ' ' : '字' }, { from: text.lastIndexOf('正文'), insert: '新' }] });
    const mapped = h.remapEditorBlocks(blocks, { startState: state, state: tr.state, changes: tr.changes });
    assert.ok(mapped);
    assert.equal(JSON.stringify(mapped), JSON.stringify(h.editorBlocks(tr.state)));
    blocks = mapped; state = tr.state;
  }
});

test("blank lines and HTML terminators always use a full structural rebuild", () => {
  const { EditorState } = require("@codemirror/state"), h = incrementalHarness();
  for (const doc of ['<div>\n中文正文\n```js\nx=1\n```', '<script>\n文字 </script>\n\n```js\nx=1\n```']) {
    const state = EditorState.create({ doc }), blocks = h.editorBlocks(state), from = doc.indexOf('文字') >= 0 ? doc.indexOf('</script>') : doc.indexOf('中文正文');
    const tr = state.update({ changes: { from, to: from + (doc.includes('</script>') ? 9 : 4), insert: '' } });
    assert.equal(h.remapEditorBlocks(blocks, { startState: state, state: tr.state, changes: tr.changes }), null);
  }
});

test("quote/list indentation changes invalidate the mapped fence index", () => {
  const { EditorState } = require("@codemirror/state"), h = incrementalHarness();
  for (const marker of ['-', '1.']) {
    const indent = ' '.repeat(marker.length + 1);
    const state = EditorState.create({ doc: `> ${marker} \`\`\`js\n> ${indent}function f() {\n> ${indent}  return 1;\n> ${indent}}\n> ${indent}\`\`\`` });
    const blocks = h.editorBlocks(state), from = state.doc.line(2).from + 2;
    assert.equal(blocks.length, 1);
    const tr = state.update({ changes: { from, to: from + indent.length, insert: '' } });
    assert.equal(h.remapEditorBlocks(blocks, { startState: state, state: tr.state, changes: tr.changes }), null);
  }
});

test("languages without a structural provider fall back to nested indentation ranges", () => {
  const cases = {
    graphql: 'query Demo {\n  users {\n    id\n  }\n}',
    vue: '<template>\n  <section>\n    hello\n  </section>\n</template>',
    json5: '{\n  items: [\n    1,\n  ]\n}',
    unknown: 'root\n  child\n    leaf\n  peer\nend'
  };
  for (const [language, text] of Object.entries(cases)) {
    const regions = foldRegions(text, language);
    assert.equal(regions.length, 2, language);
    assert.equal(regions[0].startLine, 0, language);
    assert.ok(regions[1].from > regions[0].from && regions[1].to <= regions[0].to, language);
    for (const region of regions) assert.ok(region.to > region.from && region.endLine > region.startLine, language);
  }
});

test("indentation fallback ignores blank lines and preserves CRLF offsets and final lines", () => {
  const text = 'root:\r\n\r\n  child: 1\r\n  \r\nnext: 2\r\nlast:\r\n  value: 3';
  const regions = foldRegions(text, 'unknown');
  assert.deepEqual(regions.map(r => [r.startLine, r.endLine]), [[0, 2], [5, 6]]);
  assert.equal(text.slice(regions[0].from, regions[0].to), '\r\n\r\n  child: 1');
  assert.equal(text.slice(regions[1].from, regions[1].to), '\r\n  value: 3');
  assert.deepEqual(foldRegions('a\nb\n\n', 'text'), []);
});

test("new language providers recognize structure independently of indentation", () => {
  const cases = {
    yaml: 'items: [\n1,\n2\n]\nnext: true',
    yml: 'defaults:\n  nested:\n    enabled: true\nnext: false',
    scss: '.panel {\n.child {\ncolor: red;\n}\n}',
    less: '.panel {\n.child {\ncolor: red;\n}\n}',
    xml: '<root>\n<child>\nvalue\n</child>\n</root>',
    markdown: '# Section\nparagraph\n\n## Child\ntext\n\n# Next\nend',
    md: '# Section\ntext\n# Next',
    sql: 'SELECT\nname,\nid\nFROM employees;\nSELECT 1;',
    php: 'function run() {\nreturn [\n1,\n2\n];\n}',
  };
  for (const [language, text] of Object.entries(cases)) {
    const ranges = foldRegions(text, language);
    assert.ok(ranges.some(r => r.startLine === 0), language);
    assert.equal(new Set(ranges.map(r => r.startLine)).size, ranges.length, language);
    for (const r of ranges) assert.ok(r.from >= 0 && r.to <= text.length && r.endLine > r.startLine, language);
  }
});

test("provider boundaries preserve siblings, closing tokens and literal contents", () => {
  const xml = '<root>\r\n<child>\r\nx\r\n</child>\r\n</root>\r\n<next/>';
  const element = foldRegions(xml, 'xml')[0];
  assert.equal(xml.slice(element.from, element.to), '\r\n<child>\r\nx\r\n</child>\r\n');
  const md = '# First\ntext\n## Nested\nbody\n# Second\nlast';
  const heading = foldRegions(md, 'markdown')[0];
  assert.equal(md.slice(heading.from, heading.to), '\ntext\n## Nested\nbody');
  for (const language of ['scss', 'less', 'php']) {
    const literal = language === 'php' ? '$s = "first\n  second";' : '.a { content: "first\\a second"; }';
    assert.deepEqual(foldRegions(literal, language), [], language);
  }
  // SQL 的整个跨行语句可折叠，但字符串内部不能产生额外缩进范围。
  assert.equal(foldRegions("SELECT 'first\n  second\n    third';", 'sql').length, 1);
  const php = '<?php\nfunction run() {\nreturn 1;\n}\n?>';
  assert.ok(foldRegions(php, 'php').some(r => r.startLine === 1 && r.endLine === 3));
  const plainWithTagString = '$tag = "<?php";\nfunction run() {\nreturn 1;\n}';
  assert.ok(foldRegions(plainWithTagString, 'php').some(r => r.startLine === 1 && r.endLine === 3));
  const yaml = 'description: |\n  first\n  a  b\nnext: true';
  assert.ok(foldRegions(yaml, 'yaml').some(r => r.startLine === 0 && !yaml.slice(r.from, r.to).includes('next')));
});

test("new providers handle comments, containers, CRLF and adjacent statements", () => {
  for (const language of ['scss', 'less', 'sql', 'php']) {
    const comment = '/* first\n  body {\n    nested\n} */';
    const ranges = foldRegions(comment, language);
    assert.equal(ranges.length, 1, language);
    assert.equal(comment.slice(ranges[0].from, ranges[0].to), ' first\n  body {\n    nested\n} ', language);
  }
  const sql = 'SELECT (\n1\n);\nSELECT\n2;';
  assert.deepEqual(foldRegions(sql, 'sql').map(r => [r.startLine, r.endLine]), [[0, 2], [3, 4]]);
  const md = '- first\n  continued\n- second\n\n> quote\n> continued\n\n```js\nlet x = 1;\n```';
  assert.deepEqual(foldRegions(md, 'md').map(r => [r.startLine, r.endLine]), [[0, 2], [4, 5], [7, 8]]);
  assert.deepEqual(foldRegions('# First\r\nbody\r\n\r\n# Next\r\nlast', 'md').map(r => [r.startLine, r.endLine]), [[0, 1], [3, 4]]);
  const unclosedCode = '````js\nfirst\n```';
  assert.equal(foldRegions(unclosedCode, 'md')[0].to, unclosedCode.length, 'a shorter fence remains code content');
  for (const language of ['yaml', 'scss', 'less', 'xml', 'sql', 'php', 'markdown']) assert.deepEqual(foldRegions('', language), [], language);
});

test("indentation fallback uses visual tab stops and structural parsing remains authoritative", () => {
  const text = 'root\n  parent\n\tchild\nend';
  assert.equal(foldRegions(text, 'unknown', 2).length, 1);
  assert.equal(foldRegions(text, 'unknown', 4).length, 2);
  assert.deepEqual(foldRegions('const s = `\n  indented text\n`;', 'javascript'), []);
  const js = 'function run() {\nreturn 1;\n}';
  for (const language of ['javascript', 'js', 'mjs', 'cjs']) {
    assert.deepEqual(foldRegions(js, language).map(r => [r.startLine, r.endLine]), [[0, 2]], language);
  }
});

function bodyStyle(language, folding = true, returnClass = false, quoted = false) {
  const raw = `\`\`\`${language}\nconst value = {\n  a: 1\n};\n\`\`\``;
  const source = quoted ? raw.split("\n").map(line => "> " + line).join("\n") : raw;
  const lines = source.split("\n"); let offset = 0;
  const records = lines.map((text, index) => { const row = { text, number: index + 1, from: offset, to: offset + text.length }; offset += text.length + 1; return row; });
  const doc = { length: source.length, toString: () => source, line: n => records[n - 1], lineAt: pos => records.find(row => pos >= row.from && pos <= row.to) || records.at(-1) };
  const tree = { iterate({ enter }) { for (const [index, row] of records.entries()) enter({ name: quoted ? "QuoteMark" : index === 0 ? "HyperMD-codeblock-begin" : index === records.length - 1 ? "HyperMD-codeblock-end" : "HyperMD-codeblock", from: row.from, to: row.to }); } };
  const Decoration = { line: spec => ({ range: from => ({ type: "line", spec, from }) }), widget: () => ({ range: from => ({ type: "widget", from }) }), set: list => list };
  const sandbox = { module: { exports: {} }, require(name) {
    if (name === "obsidian") return { Plugin: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {} };
    if (name === "@codemirror/view") return { WidgetType: class {}, ViewPlugin: { fromClass: C => C }, Decoration };
    if (name === "@codemirror/state") return {};
    if (name === "@codemirror/language") return { syntaxTree: () => tree, foldedRanges: () => ({ between() {} }) };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/main-source.js`, "utf8") + "\nmodule.exports.editorWrapping = editorWrapping;", sandbox);
  const C = sandbox.module.exports.editorWrapping({ revision: 0, settings: { folding, wrap: true } });
  if (returnClass) return C;
  const view = { state: { doc, tabSize: 4, selection: { ranges: [] } }, visibleRanges: [{ from: 0, to: source.length }], contentDOM: { clientWidth: 1000 } };
  return C.prototype.build.call({}, view).find(x => x.type === "line" && x.from === records[1].from).spec.attributes.style;
}

test("quoted fences get editor controls even when the host only parses them as inline code", () => {
  const sandbox = { module: { exports: {} }, require(name) {
    if (name === "obsidian") return { Plugin: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {} };
    if (name === "@codemirror/view") return { WidgetType: class {} };
    if (name === "@codemirror/state") return {};
    if (name === "@codemirror/language") return { syntaxTree: () => ({ iterate() {} }) };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/main-source.js`, "utf8") + "\nmodule.exports.editorBlocks = editorBlocks;", sandbox);
  function blocks(source) {
    let offset = 0;
    const rows = source.split("\n").map((text, index) => { const row = { text, number: index + 1, from: offset, to: offset + text.length }; offset += text.length + 1; return row; });
    return sandbox.module.exports.editorBlocks({ tabSize: 4, doc: { toString: () => source, line: n => rows[n - 1], lineAt: pos => rows.find(r => pos >= r.from && pos <= r.to) || rows.at(-1) } });
  }
  const source = '> [!note] 容器\n>\n> ```python\n> values=[1,2]\n> ```\n';
  const found = blocks(source);
  assert.equal(found.length, 1);
  assert.equal(found[0].open.number, 3); assert.equal(found[0].close.number, 5);
  assert.equal(found[0].options.language, "python");
  assert.equal(blocks(source + source).length, 2);
  const outer = blocks('```markdown\n> ```python\n> x=1\n> ```\n```');
  assert.equal(outer.length, 1);
  assert.equal(outer[0].options.language, "markdown");
  assert.equal(blocks('> ```python\n> x=1\n').length, 0);
  assert.equal(blocks('> > ~~~python\n> > x=1\n> > ~~~').length, 1);
});

test("format controls use the reading copy button size independently of language label size", () => {
  const C = bodyStyle("javascript", true, true);
  for (const labelHeight of [24, 42, 60]) {
    const flair = { getBoundingClientRect: () => ({ left: 200, top: 10, width: 120, height: labelHeight }) };
    const host = { querySelector: () => flair, getBoundingClientRect: () => ({ right: 400, top: 0 }) };
    const button = { style: {}, dataset: {}, closest: () => host };
    const view = { dom: { querySelectorAll: () => [button] }, requestMeasure({ read, write }) { write(read()); } };
    C.prototype.alignButtons.call({}, view);
    assert.equal(button.style.height, "28px");
  }
  const css = fs.readFileSync(`${__dirname}/styles.css`, "utf8");
  assert.match(css, /width: 32px;\s*height: 28px;/);
  assert.doesNotMatch(css, /width: 36px/);
});

test("editor decorations do not add a gutter to the theme's existing code inset", () => {
  for (const language of ["javascript", "vue", "scss", "less", "yaml", "text"]) {
    for (const folding of [true, false]) assert.doesNotMatch(bodyStyle(language, folding), /--qn-gutter:(?!0(?:px|ch)(?:;|$))/, `${language}, folding=${folding}`);
  }
});

test("quoted code body rows keep hover ownership and account for quote prefixes without native code tokens", () => {
  assert.match(bodyStyle("javascript", true, false, true), /--qn-source-indent:2ch/);
  const css = fs.readFileSync(`${__dirname}/styles.css`, "utf8");
  assert.match(css, /\.cm-line\.qn-editor-code-line\s*\{\s*position:\s*relative/);
});

test("JSX and TSX elements have fold ranges, not only their embedded JS expressions", () => {
  const code = 'const Component = () => (\n  <section>\n    <ul>\n      <li>value</li>\n    </ul>\n  </section>\n);';
  for (const language of ["jsx", "tsx"]) {
    const regions = foldRegions(code, language);
    assert.ok(regions.some(r => r.startLine === 1 && r.endLine === 5), `${language}: section`);
    assert.ok(regions.some(r => r.startLine === 2 && r.endLine === 4), `${language}: ul`);
    assert.equal(new Set(regions.map(r => r.startLine)).size, regions.length);
  }
});

test("native arrows nested in token spans are hidden only on plugin-owned rows", () => {
  const { document } = parseHTML('<div class="markdown-source-view mod-cm6"><div class="qn-editor-code-line"><button class="qn-fold-toggle"></button><span class="cm-hmd-codeblock"><div id="owned" class="cm-fold-indicator"></div></span></div><div class="qn-editor-code-line"><span><div id="fallback" class="cm-fold-indicator"></div></span></div></div>');
  const css = fs.readFileSync(`${__dirname}/styles.css`, "utf8");
  const selector = css.match(/([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/)[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.deepEqual(Array.from(document.querySelectorAll(selector), node => node.id), ["owned"]);
});
