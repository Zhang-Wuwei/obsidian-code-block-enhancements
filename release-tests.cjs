"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRelease, RELEASE_FILES } = require("./release.cjs");
const { deploy } = require("./deploy.cjs");
const vm = require("node:vm");

test("release runtime assets use the three-file community layout", () => {
  assert.deepEqual(RELEASE_FILES, ["main.js", "manifest.json", "styles.css"]);
});

test("the community-install main.js carries complete project and third-party notices", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const begin = "// BEGIN CODE BLOCK ENHANCEMENTS LICENSE NOTICES\n";
  const end = "// END CODE BLOCK ENHANCEMENTS LICENSE NOTICES\n";
  const start = bundle.indexOf(begin);
  assert.ok(start >= 0, "main.js must retain notices even when only three community assets are downloaded");
  const finish = bundle.indexOf(end, start);
  assert.ok(finish > start);
  const decoded = bundle.slice(start + begin.length, finish).split("\n").filter(line => line.startsWith("// ")).map(line => line.slice(3)).join("\n");
  const expected = ["LICENSE", "THIRD-PARTY-NOTICES.txt"].map(name => fs.readFileSync(path.join(__dirname, name), "utf8").replace(/\r\n/g, "\n").trimEnd()).join("\n\n");
  assert.equal(decoded, expected);
});

test("release includes runtime files only; deploy preserves settings and validates hashes", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cbe-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = { id: "code-block-enhancements", version: "0.3.1" };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: manifest.version }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ version: manifest.version, packages: { '': { version: manifest.version } } }));
  for (const name of RELEASE_FILES) fs.writeFileSync(path.join(root, name), name === "manifest.json" ? JSON.stringify(manifest) : name);
  const destination = createRelease(root);
  assert.deepEqual(fs.readdirSync(destination).sort(), [...RELEASE_FILES, "checksums.json"].sort());
  assert.equal(createRelease(root), destination, "identical packaging may be repeated");
  fs.writeFileSync(path.join(root, "main.js"), "different build");
  assert.throws(() => createRelease(root), /same version|different content/i);
  assert.equal(fs.readFileSync(path.join(destination, "main.js"), "utf8"), "main.js");
  fs.writeFileSync(path.join(root, "main.js"), "main.js");
  const vault = path.join(root, "vault");
  const target = path.join(vault, ".obsidian", "plugins", manifest.id);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(target, "data.json"), '{"wrap":false}');
  deploy(vault, root);
  assert.equal(fs.readFileSync(path.join(target, "data.json"), "utf8"), '{"wrap":false}');
  assert.equal(fs.readFileSync(path.join(target, "main.js"), "utf8"), "main.js");
  fs.writeFileSync(path.join(destination, "styles.css"), "tampered");
  fs.writeFileSync(path.join(target, "main.js"), "installed");
  assert.throws(() => deploy(vault, root), /checksum mismatch/);
  assert.equal(fs.readFileSync(path.join(target, "main.js"), "utf8"), "installed");
  assert.throws(() => deploy(undefined, root), /explicit vault/);
  manifest.version = '0.3.2';
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => createRelease(root), /versions do not match/);
});

test("the real bundled plugin formats without separate runtime files or npm packages", async () => {
  const context = { module: { exports: {} }, console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {} };
      // 仅宿主公开的核心模块可外置；语言包必须已经进入 bundle。
      if (['@codemirror/view', '@codemirror/state', '@codemirror/language', '@codemirror/autocomplete', '@codemirror/commands', '@codemirror/search', '@codemirror/lint', '@lezer/common', '@lezer/lr', '@lezer/highlight'].includes(name)) return require(name);
      throw new Error(`Unbundled runtime dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), context);
  const plugin = new context.module.exports();
  plugin.settings = { formatWidth: 100, formatTabWidth: 2, formatSemi: true };
  let value = '```js\nconst x={a:1};\n```\n';
  const offset = p => value.split('\n').slice(0, p.line).reduce((n, s) => n + s.length + 1, 0) + p.ch;
  const view = { file: { path: 'test.md' }, getState: () => ({ mode: 'source' }), getMode: () => 'source',
    editor: { getValue: () => value,
      offsetToPos(n) { const before = value.slice(0, n); return { line: before.split('\n').length - 1, ch: n - before.lastIndexOf('\n') - 1 }; },
      transaction({ changes }) { for (const c of [...changes].reverse()) value = value.slice(0, offset(c.from)) + c.text + value.slice(offset(c.to)); }
    }
  };
  view.leaf = { view };
  const result = await plugin.formatCodeBlock(view, 0);
  assert.equal(result.ok, true, result.message);
  assert.ok(value.includes('const x = { a: 1 };'));
});
