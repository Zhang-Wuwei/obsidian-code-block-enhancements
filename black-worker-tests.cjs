"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { BlackWorker } = require("./black-worker.js");
function fake() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => {}; child.kill = () => { child.killed = true; };
  return child;
}
test("worker reuses one process and decodes split UTF-8 JSON responses", async () => {
  const child = fake(); let spawns = 0;
  child.stdin.write = line => {
    const request = JSON.parse(line), data = Buffer.from(JSON.stringify({ id: request.id, ok: true, code: "中文 = 1\n" }) + "\n");
    const split = data.indexOf(Buffer.from("中文")) + 1;
    child.stdout.emit("data", data.subarray(0, split)); child.stdout.emit("data", data.subarray(split));
  };
  const worker = new BlackWorker({ executable: "python.exe", wheels: [], spawn: () => {
    spawns++; setImmediate(() => child.stdout.emit("data", Buffer.from('{"ready":"26.10.1"}\n'))); return child;
  } });
  assert.equal(await worker.format("x=1"), "中文 = 1\n");
  assert.equal(await worker.format("y=1"), "中文 = 1\n");
  assert.equal(spawns, 1); worker.dispose(); assert.equal(child.killed, true);
});
test("worker errors do not return source as success, and unload rejects pending requests", async () => {
  const child = fake(); child.stdin.write = line => { const { id } = JSON.parse(line); child.stdout.emit("data", Buffer.from(JSON.stringify({ id, ok: false, error: "Cannot parse" }) + "\n")); };
  const worker = new BlackWorker({ executable: "python.exe", wheels: [], spawn: () => { setImmediate(() => child.stdout.emit("data", Buffer.from('{"ready":"26.10.1"}\n'))); return child; } });
  await assert.rejects(worker.format("broken"), /Cannot parse/);
  child.stdin.write = () => {};
  const pending = worker.format("x=1"); await new Promise(r => setImmediate(r)); worker.dispose();
  await assert.rejects(pending, /取消|卸载/);
});
test("timeout kills the worker and the next request starts a fresh process", async () => {
  const children = [];
  const worker = new BlackWorker({ executable: "python.exe", wheels: [], timeout: 30, spawn: () => {
    const child = fake(); children.push(child);
    child.stdin.write = line => { if (children.length > 1) { const { id } = JSON.parse(line); child.stdout.emit("data", Buffer.from(JSON.stringify({ id, ok: true, code: "x = 1\n" }) + "\n")); } };
    setImmediate(() => child.stdout.emit("data", Buffer.from('{"ready":"26.10.1"}\n'))); return child;
  } });
  await assert.rejects(worker.format("x=1"), /超时/);
  assert.equal(children[0].killed, true);
  assert.equal(await worker.format("x=1"), "x = 1\n");
  assert.equal(children.length, 2); worker.dispose();
});
