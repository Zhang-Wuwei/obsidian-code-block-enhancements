"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planFormatting, findCodeBlocks, applyChanges, locateCodeBlock } = require("./formatting.js");
const fence = (lang, code) => `\`\`\`${lang}\n${code}\n\`\`\``;
const cursor = source => [{ from: source.indexOf("const"), to: source.indexOf("const") }];

test("fenced strings in Obsidian frontmatter are never treated as Markdown code blocks", async () => {
  for (const eol of ['\n', '\r\n']) for (const bom of ['', '\uFEFF']) {
    const metadata = bom + '---\nexample: |\n  ```js\n  const x={a:1};\n  ```\n---\n\n';
    const source = (metadata + fence('js', 'const data={b:2};')).replace(/\n/g, eol);
    const blocks = findCodeBlocks(source);
    assert.equal(blocks.length, 1);
    const plan = await planFormatting(source, [{ from: blocks[0].from, to: blocks[0].from }]);
    assert.ok(applyChanges(source, plan.changes).startsWith(metadata.replace(/\n/g, eol)));
  }
});

test("fence snapshot reuse is immutable, bounded and invalidates on source changes", () => {
  const source = '> ```java\n> class A{}\n> ```';
  const blocks = findCodeBlocks(source);
  assert.equal(findCodeBlocks(source), blocks);
  assert.throws(() => { blocks[0].bodyTo = 0; }, TypeError);
  assert.throws(() => { blocks[0].quoteRanges[0].to = 0; }, TypeError);
  assert.throws(() => { blocks.push({}); }, TypeError);
  const changed = source.replace('A', 'B');
  assert.match(findCodeBlocks(changed)[0].value, /class B/);
  findCodeBlocks(fence('js', 'const x=1;'));
  assert.notEqual(findCodeBlocks(source), blocks);
});

async function formattedBody(language, code, options = {}) {
  const source = fence(language, code);
  const result = await planFormatting(source, [{ from: 0, to: 0 }], options);
  return findCodeBlocks(applyChanges(source, result.changes))[0].value;
}

test("final audit: formatting preserves all bytes outside the selected fence without adding invisible markers", async () => {
  const before = '\uFEFF---\ntitle: 边界审查\n---\n\n# 普通正文\n中文  双空格、emoji 😀、零宽\u200b和 NBSP\u00a0保留。\n\n`const x=1`\n\n```text\n不要改动的其他代码块\n```\n\n';
  const after = '\n\n尾部正文。\n\n| 列 | 值 |\n| --- | --- |\n| A | 1 |\n\n[链接](example.md)\n';
  const cases = [
    '```js\nconst data={name:"demo",items:[1,2]};\n```',
    '> [!note] Callout\n>\n> ```js\n> const data={name:"demo",items:[1,2]};\n> ```',
    '- 列表\n\n  ```js\n  const data={name:"demo",items:[1,2]};\n  ```',
    '> > ~~~~js\n> > const data={name:"demo",items:[1,2]};\n> > ~~~~'
  ];
  for (const eol of ['\n', '\r\n']) for (const body of cases) {
    const source = (before + body + after).replace(/\n/g, eol);
    const target = findCodeBlocks(source).find(b => b.language === 'js');
    const plan = await planFormatting(source, [{ from: target.from, to: target.from }]);
    assert.ok(plan.changes.length);
    assert.ok(plan.changes.every(c => c.from >= target.bodyFrom && c.to <= target.bodyTo));
    const output = applyChanges(source, plan.changes);
    assert.ok(output.startsWith(source.slice(0, target.bodyFrom)));
    assert.ok(output.endsWith(source.slice(target.bodyTo)));
    for (const marker of ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff']) {
      assert.equal(output.split(marker).length, source.split(marker).length, marker.codePointAt(0).toString(16));
    }
    assert.equal((await planFormatting(output, [{ from: target.from, to: target.from }])).changes.length, 0);
  }
});

test("final audit: multiline CRLF blocks and rendered LF snapshots keep safe boundaries", async () => {
  for (const prefix of ["", "> "]) {
    const body = ['```JS', 'function add(a,b){', 'return a+b;}', '```'].map(line => prefix + line).join('\r\n');
    const source = 'before\r\n\r\n' + body + '\r\n\r\nafter\r\n';
    const target = findCodeBlocks(source)[0];
    assert.doesNotThrow(() => locateCodeBlock(source, target.line - 1, 'function add(a,b){\nreturn a+b;}\n'));
    const plan = await planFormatting(source, [{ from: target.from, to: target.from }]);
    const updated = applyChanges(source, plan.changes);
    assert.ok(updated.startsWith(source.slice(0, target.bodyFrom)));
    assert.ok(updated.endsWith(source.slice(target.bodyTo)));
    assert.match(updated, /return a \+ b;/);
    assert.equal((await planFormatting(updated, [{ from: target.from, to: target.from }])).changes.length, 0);
  }
});

test("extended style preferences affect indentation, objects, JSX and HTML output", async () => {
  assert.match(await formattedBody("js", 'const x = {\n  a: 1,\n};', { useTabs: true }), /\n\ta: 1/);
  assert.equal(await formattedBody("js", 'const x={a:1};', { bracketSpacing: false }), 'const x = {a: 1};');
  assert.match(await formattedBody("js", 'const x={a:1,"b-c":2};', { quoteProps: "consistent" }), /"a": 1/);
  assert.match(await formattedBody("jsx", 'const x=<div id="a"/>;', { jsxSingleQuote: true }), /id='a'/);
  assert.equal(await formattedBody("js", 'const x={\na:1\n};', { objectWrap: "collapse" }), 'const x = { a: 1 };');
  assert.match(await formattedBody("html", '<button id="x" class="y">Save</button>', { singleAttributePerLine: true, bracketSameLine: true }), /class="y">/);
  assert.match(await formattedBody("vue", '<script>const x=1;</script>', { embeddedLanguageFormatting: true, vueIndentScriptAndStyle: true }), /<script>\n  const x = 1;/);
  assert.match(await formattedBody("vue", '<script>const x=1;</script>', { embeddedLanguageFormatting: false, vueIndentScriptAndStyle: true }), /<script>\n  const x=1;/);
  const input = '<span>hello</span><span>world</span>';
  assert.notEqual(await formattedBody("html", input, { htmlWhitespaceSensitivity: "strict", printWidth: 20 }), await formattedBody("html", input, { htmlWhitespaceSensitivity: "ignore", printWidth: 20 }));
});

test("trailing commas default to all and distinguish object from function parameter positions", async () => {
  const code = 'const value = {\n  first: 1,\n  second: 2,\n};\nrun(firstLongArgument, secondLongArgument);';
  const base = { printWidth: 25 };
  const defaults = await formattedBody("js", code, base);
  assert.match(defaults, /second: 2,\n/);
  assert.match(defaults, /secondLongArgument,\n\)/);
  const none = await formattedBody("js", code, { ...base, trailingComma: "none" });
  assert.match(none, /second: 2\n/);
  assert.match(none, /secondLongArgument\n\)/);
  const es5 = await formattedBody("js", code, { ...base, trailingComma: "es5" });
  assert.match(es5, /second: 2,\n/);
  assert.match(es5, /secondLongArgument\n\)/);
  const all = await formattedBody("js", code, { ...base, trailingComma: "all" });
  assert.match(all, /secondLongArgument,\n\)/);
  for (const trailingComma of ["none", "es5", "all"]) {
    const json = await formattedBody("json", '{"first":1,"second":2}', { trailingComma, printWidth: 10 });
    assert.deepEqual(JSON.parse(json), { first: 1, second: 2 });
  }
});

test("arrow parentheses default to always; avoid removes only optional parentheses", async () => {
  const code = 'const f = (x) => x;\nconst g = (x, y) => x + y;\nconst h = () => 1;';
  assert.match(await formattedBody("js", code), /const f = \(x\) => x;/);
  const avoid = await formattedBody("js", code, { arrowParens: "avoid" });
  assert.match(avoid, /const f = x => x;/);
  assert.match(avoid, /const g = \(x, y\) => x \+ y;/);
  assert.match(avoid, /const h = \(\) => 1;/);
});

test("single attribute per line is optional and applies to HTML and embedded Vue templates", async () => {
  const code = '<button id="save" class="primary" type="button">Save</button>';
  assert.equal(await formattedBody("html", code), code);
  for (const language of ["html", "vue"]) {
    const input = language === "vue" ? `<template>${code}</template>` : code;
    const result = await formattedBody(language, input, { singleAttributePerLine: true, embeddedLanguageFormatting: true });
    assert.match(result, /<button\n\s+id="save"\n\s+class="primary"\n\s+type="button"/);
  }
});

test("formatting preserves runtime whitespace inside tagged embedded-language strings", async () => {
  const code = 'const x=html`<div>  x   y </div>`;';
  const source = fence('js', code);
  const output = applyChanges(source, (await planFormatting(source, cursor(source))).changes);
  assert.ok(output.includes('html`<div>  x   y </div>`'));
});

test("embedded-language formatting requires explicit opt-in", async () => {
  const source = fence('js', 'const x=html`<div>  x   y </div>`;');
  const result = await planFormatting(source, cursor(source), { embeddedLanguageFormatting: true });
  assert.ok(applyChanges(source, result.changes).includes('html`<div>x y</div>`'));
});

test("syntax failures explain position and cause without a raw parser code frame", async () => {
  await assert.rejects(planFormatting(fence("js", "const broken = ;"), [{ from: 6, to: 6 }]), error => {
    assert.match(error.message, /代码块第 1 行.*第 16 列/);
    assert.match(error.message, /语法|表达式|符号/);
    assert.doesNotMatch(error.message, /Unexpected token|> 1 \||\^/);
    return true;
  });
});
test("only replaces body, preserving prose, fence options, and other code blocks", async () => {
  const source = "# Keep  spaces\n\n" + fence("js ln start=3", "const x={a:1};") + "\n\n| A | B |\n| - | - |\n" + fence("java", "class A{}") + "\n";
  const result = await planFormatting(source, cursor(source));
  assert.equal(result.changes.length, 1);
  const change = result.changes[0];
  assert.equal(source.slice(change.from, change.to), "const x={a:1};\n");
  const output = applyChanges(source, result.changes);
  assert.ok(output.includes("const x = { a: 1 };"));
  assert.equal(output.slice(0, change.from), source.slice(0, change.from));
  assert.ok(output.endsWith(source.slice(change.to)));
});
test("partial or bare code selection formats containing block", async () => {
  const source = fence("javascript", "const x={a:1};");
  const from = source.indexOf("x=");
  assert.equal((await planFormatting(source, [{ from, to: from + 2 }])).changes.length, 1);
});
test("outside code refuses without edits", async () => {
  await assert.rejects(planFormatting("# Text\n\n" + fence("js", "const x=1;"), [{ from: 1, to: 1 }]), /代码块/);
});
test("unsupported languages report rather than silently skip", async () => {
  for (const lang of ["go", "rust", "text", "dataviewjs", ""]) {
    await assert.rejects(planFormatting(fence(lang, "hello"), [{ from: 0, to: 0 }]), /不支持|语言/);
  }
});

test("Java comments around control-flow parentheses retain text and format idempotently", async () => {
  const code = 'class Demo { void run(boolean ready) { if(ready){ // 中文注释\n return; } /* 保留块注释 */ } }';
  const result = await formattedBody("java", code);
  assert.match(result, /\/\/ 中文注释/);
  assert.match(result, /\/\* 保留块注释 \*\//);
  assert.equal(await formattedBody("java", result), result);
});

test("Java formats classes and method fragments idempotently", async () => {
  for (const code of ["class Demo{int x=1;void run(){System.out.println(x);}}", "public int add(int a,int b){return a+b;}"]) {
    const result = await formattedBody("java", code);
    assert.match(result, /a \+ b|int x = 1/);
    assert.equal(await formattedBody("java", result), result);
  }
});

test("managed formatters retain containers, reject injected fences and propagate failures", async () => {
  const source = "> before\n>\n> ```python\n> x=1\n> ```\n\nafter\n";
  const options = { formatManaged: async (code, language) => {
    assert.equal(code, "x=1"); assert.equal(language, "python"); return "x = 1\r\n";
  } };
  const output = applyChanges(source, (await planFormatting(source, [{ from: source.indexOf("x=1"), to: source.indexOf("x=1") }], options)).changes);
  assert.equal(output, source.replace("x=1", "x = 1"));
  await assert.rejects(planFormatting(fence("c", "int x;"), [{ from: 0, to: 0 }], { formatManaged: async () => "```\n" }), /围栏/);
  await assert.rejects(planFormatting(fence("py", "x=1"), [{ from: 0, to: 0 }], { formatManaged: async () => { throw Error("组件下载失败"); } }), /组件下载失败/);
});
test("invalid syntax is an error with line context", async () => {
  await assert.rejects(planFormatting(fence("js", "const = ;"), [{ from: 0, to: 0 }]), /代码块第 1 行.*原代码未修改/s);
});
test("one failure aborts multiple-block plan", async () => {
  const source = fence("js", "const x={a:1};") + "\n\n" + fence("js", "const = ;");
  await assert.rejects(planFormatting(source, [{ from: 0, to: source.length }]), /原代码未修改/);
});
test("multiple selections deduplicate and format both blocks", async () => {
  const source = fence("js", "const x={a:1};") + "\n\nprose\n\n" + fence("json", '{"a":1}');
  const a = source.indexOf("const"), b = source.indexOf('{"a"');
  const result = await planFormatting(source, [{ from: a, to: a }, { from: a + 2, to: a + 3 }, { from: b, to: b }]);
  assert.equal(result.changes.length, 2);
});
test("selection spanning partial blocks is rejected", async () => {
  const source = fence("js", "const x={a:1};") + "\n" + fence("js", "const y={b:2};");
  await assert.rejects(planFormatting(source, [{ from: source.indexOf("const"), to: source.length }]), /完整/);
});
test("Callout prefixes remain and nested output parses correctly", async () => {
  const source = '> [!note] Keep\n>\n> ```js\n> function f(){return {a:1};}\n> ```\n';
  const output = applyChanges(source, (await planFormatting(source, [{ from: source.indexOf("function"), to: source.indexOf("function") }])).changes);
  assert.ok(output.startsWith("> [!note] Keep\n>\n> ```js\n"));
  assert.ok(output.endsWith("> ```\n"));
  const block = findCodeBlocks(output)[0];
  assert.ok(block.value.includes("  return { a: 1 };"));
});
test("list and blockquote nesting retain container prefixes", async () => {
  const source = '- Keep\n\n  > ```js\n  > function f(){return 1;}\n  > ```\n';
  const output = applyChanges(source, (await planFormatting(source, [{ from: source.indexOf("function"), to: source.indexOf("function") }])).changes);
  assert.ok(output.includes("  >   return 1;\n"));
  assert.ok(output.endsWith("  > ```\n"));
});
test("tilde fences, long fences, blank lines, CRLF", async () => {
  for (const marker of ["~~~", "````"]) {
    const source = `prefix\r\n\r\n${marker}js meta\r\nconst x={a:1};\r\n\r\n${marker}\r\nend`;
    const output = applyChanges(source, (await planFormatting(source, cursor(source))).changes);
    assert.ok(output.includes(`${marker}js meta\r\n`));
    assert.ok(output.endsWith(`${marker}\r\nend`));
    assert.equal(output.replace(/\r\n/g, "").includes("\n"), false);
  }
});
test("unclosed fence refuses", async () => {
  await assert.rejects(planFormatting("```js\nconst x=1;", [{ from: 0, to: 0 }]), /闭合/);
});
test("indented code is not treated as fenced code", async () => {
  await assert.rejects(planFormatting("    const x=1;", [{ from: 5, to: 5 }]), /围栏|代码块/);
});
test("format is idempotent and supports style options", async () => {
  const source = fence("js", 'const x={a:"hello"};');
  const options = { tabWidth: 4, singleQuote: true, semi: false, printWidth: 100 };
  const output = applyChanges(source, (await planFormatting(source, [{ from: 0, to: 0 }], options)).changes);
  assert.ok(output.includes("const x = { a: 'hello' }"));
  assert.equal((await planFormatting(output, [{ from: 0, to: 0 }], options)).changes.length, 0);
});
test("oversized notes are rejected before parsing", async () => {
  await assert.rejects(planFormatting("x".repeat(2000001), [{ from: 0, to: 0 }]), /过大/);
});
test("supported parsers and aliases format independently", async () => {
  for (const [lang, code] of Object.entries({ ts: 'const x:number=1;', css: 'a{color:red}', html: '<div><input disabled></div>', json: '{"a":1}', yaml: 'x:  1', graphql: 'query{user{id}}', vue: '<template><div>{{x}}</div></template>' })) {
    const source = fence(lang, code);
    const result = await planFormatting(source, [{ from: 0, to: 0 }]);
    assert.equal(result.blocks, 1, lang);
  }
});
test("stale preview relocates only after code-body changes", async () => {
  const source = fence("js", "function f(){return 1;}") + "\n\nKeep\n\n" + fence("json", '{"a":1}');
  const before = findCodeBlocks(source);
  const updated = applyChanges(source, (await planFormatting(source, [{ from: 0, to: 0 }])).changes);
  const target = locateCodeBlock(updated, before[1].line - 1, before[1].value + "\n", source);
  assert.equal(target.language, "json");
  assert.notEqual(target.line, before[1].line);
  assert.throws(() => locateCodeBlock(updated.replace("Keep", "Edited"), before[1].line - 1, before[1].value + "\n", source), /结构已变化/);
  assert.throws(() => locateCodeBlock(updated.replace('{"a":1}', '{"a":2}'), before[1].line - 1, before[1].value + "\n", source), /已过期/);
});
test("closing fence Tab indentation is not copied into body", async () => {
  const source = "> ```js\n> const x={a:1};\n>\t```";
  const output = applyChanges(source, (await planFormatting(source, [{ from: 2, to: 2 }])).changes);
  assert.ok(output.includes("> const x = { a: 1 };\n"));
  assert.ok(output.endsWith(">\t```"));
});
test("compact blockquote fences preserve code indentation", async () => {
  const source = ">```js\n>function f(){\n>  return {a:1};\n>}\n>```\n>\n>```json\n>{\"a\":1}\n>```";
  const blocks = findCodeBlocks(source);
  assert.equal(blocks.length, 2);
  const result = await planFormatting(source, [{ from: blocks[0].from, to: blocks[0].from }]);
  const output = applyChanges(source, result.changes);
  assert.equal(findCodeBlocks(output)[0].value, "function f() {\n  return { a: 1 };\n}");
  assert.equal(findCodeBlocks(output)[1].value, '{"a":1}');
});
