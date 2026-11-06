"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { collectNotices } = require("./notices.cjs");

test("runtime notices include the complete upstream Prettier bundled dependency notices", () => {
  const expected = collectNotices();
  assert.equal(fs.readFileSync(path.join(__dirname, "THIRD-PARTY-NOTICES.txt"), "utf8").replace(/\r\n/g, "\n").trimEnd(), expected.trimEnd());
  const prettier = fs.readFileSync(path.join(__dirname, "node_modules/prettier/THIRD-PARTY-NOTICES.md"), "utf8").replace(/\r\n/g, "\n").trim();
  assert.ok(expected.includes(prettier));
  assert.ok(expected.includes("Apache License"));
});
