"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { ManagedFormatters, runBlack } = require("./managed-formatters.js");
const bytes = Buffer.from("verified component");
const asset = { name: "test.bin", url: "https://example.invalid/component", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
function setup(request = async () => ({ status: 200, arrayBuffer: bytes })) {
  const files = new Map(); let requests = 0;
  const adapter = { exists: async p => files.has(p), mkdir: async p => files.set(p, null),
    readBinary: async p => files.get(p), writeBinary: async (p, b) => files.set(p, b),
    rename: async (a, b) => { files.set(b, files.get(a)); files.delete(a); }, remove: async p => files.delete(p) };
  const manager = new ManagedFormatters({ adapter, baseDir: "plugin/components", request: async (...args) => { requests++; return request(...args); } });
  return { manager, files, requests: () => requests };
}
test("concurrent component requests share a verified download; cached use works offline", async () => {
  const s = setup();
  await Promise.all([s.manager.ensure(asset), s.manager.ensure(asset)]);
  assert.equal(s.requests(), 1);
  await s.manager.ensure(asset); assert.equal(s.requests(), 1);
  assert.ok(s.files.has("plugin/components/test.bin"));
  assert.equal([...s.files.keys()].filter(p => p.endsWith(".part")).length, 0);
});
test("bad hashes are never installed and failed downloads can retry", async () => {
  const s = setup(async () => ({ status: 200, arrayBuffer: Buffer.alloc(bytes.length) }));
  await assert.rejects(s.manager.ensure(asset), /校验/);
  assert.equal(s.files.has("plugin/components/test.bin"), false);
  await assert.rejects(s.manager.ensure(asset), /校验/); assert.equal(s.requests(), 2);
});
test("HTTP failures report download status separately from corrupt component bytes", async () => {
  const s = setup(async () => ({ status: 403, arrayBuffer: bytes }));
  await assert.rejects(s.manager.ensure(asset), /下载失败.*HTTP 403/);
  assert.equal(s.files.has("plugin/components/test.bin"), false);
});
test("corrupt cached components are repaired by a fresh verified download", async () => {
  const s = setup(); s.files.set("plugin/components/test.bin", Buffer.from("broken"));
  await s.manager.ensure(asset);
  assert.equal(s.requests(), 1);
  assert.deepEqual(Buffer.from(s.files.get("plugin/components/test.bin")), bytes);
});
test("C dispatch passes verified bytes and language to the WASM formatter", async () => {
  const { ASSETS } = require("./managed-formatters.js");
  const fs = require("node:fs"), wasm = fs.readFileSync(require.resolve("@wasm-fmt/clang-format/wasm"));
  const s = setup(); s.files.set(`plugin/components/${ASSETS.clang.name}`, wasm);
  const result = await s.manager.format("int x;", "c", async (source, language, bytes) => {
    assert.equal(source, "int x;"); assert.equal(language, "c"); assert.equal(bytes.length, wasm.length); return "int x;\n";
  });
  assert.equal(result, "int x;\n"); assert.equal(s.requests(), 0);
});

test("repeated C formatting reads verified WASM once per manager and releases its input bytes", async () => {
  const { ASSETS } = require('./managed-formatters.js'), fs = require('node:fs');
  const wasm = fs.readFileSync(require.resolve('@wasm-fmt/clang-format/wasm'));
  const s = setup(); s.files.set(`plugin/components/${ASSETS.clang.name}`, wasm);
  let reads = 0, calls = 0;
  s.manager.adapter.readBinary = async path => { reads++; return s.files.get(path); };
  const { formatClang } = require('./formatting.js');
  const format = async (source, language, bytes) => { calls++; assert.equal(bytes?.length, calls === 1 ? wasm.length : undefined); return formatClang(source, language, bytes); };
  await s.manager.format('int x;', 'c', format);
  await s.manager.format('int y;', 'cpp', format);
  assert.equal(reads, 1);
  assert.equal(s.manager.clangSetup, null);
  const next = setup(); next.files.set(`plugin/components/${ASSETS.clang.name}`, wasm);
  let nextReads = 0; next.manager.adapter.readBinary = async path => { nextReads++; return next.files.get(path); };
  await next.manager.format('int z;', 'c', async (_s,_l,bytes) => { assert.equal(bytes.length, wasm.length); return ''; });
  assert.equal(nextReads, 1);
});

test("failed clang initialization can retry with verified bytes", async () => {
  const { ASSETS } = require('./managed-formatters.js'), fs = require('node:fs');
  const wasm = fs.readFileSync(require.resolve('@wasm-fmt/clang-format/wasm'));
  const s = setup(); s.files.set(`plugin/components/${ASSETS.clang.name}`, wasm);
  await assert.rejects(s.manager.format('int x;', 'c', async () => { throw Error('init failed'); }), /init failed/);
  await s.manager.format('int x;', 'c', async (_s,_l,bytes) => { assert.equal(bytes.length, wasm.length); return ''; });
});
test("unsupported Python platforms reject before any component request", async () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const context = { module: { exports: {} }, process: { platform: "darwin", arch: "arm64" } };
  vm.runInNewContext(fs.readFileSync(require.resolve("./managed-formatters.js"), "utf8"), context);
  let requests = 0;
  const manager = new context.module.exports.ManagedFormatters({ adapter: {}, baseDir: "plugin/components", request: async () => { requests++; } });
  await assert.rejects(manager.format("x=1", "python"), /Windows x64/);
  assert.equal(requests, 0);
});
test("the pinned clang WASM keeps include order for C and C++ and is idempotent", async () => {
  const fs = require("node:fs"), { formatClang } = require("./formatting.js");
  const bytes = fs.readFileSync(require.resolve("@wasm-fmt/clang-format/wasm"));
  for (const language of ["c", "cpp"]) {
    const source = '#include "z.h"\n#include "a.h"\nint f(int x){return x+1;}\n';
    const result = await formatClang(source, language, bytes);
    assert.ok(result.startsWith('#include "z.h"\n#include "a.h"\n'));
    assert.match(result, /return x \+ 1;/);
    assert.equal(await formatClang(result, language, bytes), result);
  }
});
test("dispose during download prevents component writes", async () => {
  let resolve; const s = setup(() => new Promise(r => { resolve = r; }));
  const pending = s.manager.ensure(asset); await new Promise(r => setImmediate(r));
  s.manager.dispose(); resolve({ status: 200, arrayBuffer: bytes });
  await assert.rejects(pending, /卸载|取消/);
  assert.equal(s.files.has("plugin/components/test.bin"), false);
});
test("Black failures cannot be mistaken for success when stdout contains original source", async () => {
  const execute = (_exe, _args, options, callback) => {
    assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
    const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => callback(Object.assign(Error("exit 123"), { code: 123 }), "def broken(:\n", "Cannot parse: 1:11");
    return child;
  };
  await assert.rejects(runBlack("C:/cache/black.exe", "C:/cache/black.toml", "def broken(:\n", new Set(), execute), /Black.*123|Cannot parse/s);
});
