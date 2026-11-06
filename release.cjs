"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];

function createRelease(root = __dirname) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.id !== "code-block-enhancements") throw new Error("Unexpected plugin ID.");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid release version; use x.y.z.");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  if (pkg.version !== manifest.version || lock.version !== manifest.version || lock.packages?.[""]?.version !== manifest.version) throw new Error("Release versions do not match.");
  const destination = path.join(root, "dist", manifest.version);
  const assets = RELEASE_FILES.map(name => ({ name, bytes: fs.readFileSync(path.join(root, name)) }));
  fs.mkdirSync(destination, { recursive: true });
  if (fs.readdirSync(destination).some(name => ![...RELEASE_FILES, "checksums.json"].includes(name))) throw new Error("Unexpected files in release directory; inspect before packaging.");
  for (const { name, bytes } of assets) {
    const existing = path.join(destination, name);
    if (fs.existsSync(existing) && !fs.readFileSync(existing).equals(bytes)) throw new Error("Refusing different content under the same version; increment the version first.");
  }
  const hashes = {};
  for (const { name, bytes } of assets) {
    fs.writeFileSync(path.join(destination, name), bytes);
    hashes[name] = createHash("sha256").update(bytes).digest("hex");
  }
  fs.writeFileSync(path.join(destination, "checksums.json"), JSON.stringify(hashes, null, 2) + "\n");
  return destination;
}
if (require.main === module) console.log(createRelease());
module.exports = { createRelease, RELEASE_FILES };
