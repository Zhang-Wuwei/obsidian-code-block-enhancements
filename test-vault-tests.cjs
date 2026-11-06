"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function environment(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cbe-isolation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, "test-vault.cjs"), path.join(root, "test-vault.cjs"));
  fs.mkdirSync(path.join(root, "test-fixtures"));
  fs.writeFileSync(path.join(root, "test-fixtures", "sample.md"), "# sample\n\n```js\nconst x={a:1};\n```\n");
  fs.writeFileSync(path.join(root, "manifest.json"), '{"id":"code-block-enhancements","version":"0.3.2"}');
  const run = command => spawnSync(process.execPath, [path.join(root, "test-vault.cjs"), command], { encoding: "utf8" });
  return { root, run, vault: path.join(root, "test-vault") };
}

test("reset writes only the test vault and preserves extra experiments", t => {
  const { root, vault, run } = environment(t);
  fs.writeFileSync(path.join(root, "outside.md"), "keep");
  assert.equal(run("reset").status, 0);
  fs.writeFileSync(path.join(vault, "experiment.md"), "keep experiment");
  fs.writeFileSync(path.join(vault, "sample.md"), "modified");
  assert.equal(run("reset").status, 0);
  assert.equal(fs.readFileSync(path.join(vault, "sample.md"), "utf8"), fs.readFileSync(path.join(root, "test-fixtures", "sample.md"), "utf8"));
  assert.equal(fs.readFileSync(path.join(root, "outside.md"), "utf8"), "keep");
  assert.equal(fs.readFileSync(path.join(vault, "experiment.md"), "utf8"), "keep experiment");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "community-plugins.json"))), ["code-block-enhancements"]);
  const settings = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", "code-block-enhancements", "data.json")));
  assert.equal(settings.formatEmbedded, true);
  assert.equal(settings.formatTrailingComma, "none");
  assert.equal(settings.formatArrowParens, "always");
  assert.equal(settings.formatSingleAttributePerLine, false);
});

test("reset refuses a test-vault junction or symlink pointing outside", t => {
  const { root, vault, run } = environment(t);
  const outside = path.join(root, "outside"); fs.mkdirSync(outside);
  fs.symlinkSync(outside, vault, process.platform === "win32" ? "junction" : "dir");
  const result = run("reset");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Linked test path refused/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("stress data exceeds both configured size limits", t => {
  const { vault, run } = environment(t);
  assert.equal(run("stress").status, 0);
  assert.ok(fs.readFileSync(path.join(vault, "90 大代码块.md"), "utf8").length > 200000);
  assert.ok(fs.readFileSync(path.join(vault, "91 大笔记.md"), "utf8").length > 2000000);
});
