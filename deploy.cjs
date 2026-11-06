"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { RELEASE_FILES } = require("./release.cjs");

function deploy(vaultPath, root = __dirname) {
  if (!vaultPath) throw new Error("Pass an explicit vault path: npm run deploy -- <vault-path>");
  const vault = fs.realpathSync(vaultPath);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.id !== "code-block-enhancements") throw new Error("Unexpected plugin ID.");
  const release = path.join(root, "dist", manifest.version);
  const checksums = JSON.parse(fs.readFileSync(path.join(release, "checksums.json"), "utf8"));
  // Validate every release file before touching the installed plugin.
  const files = RELEASE_FILES.map(name => {
    const bytes = fs.readFileSync(path.join(release, name));
    if (createHash("sha256").update(bytes).digest("hex") !== checksums[name]) throw new Error(`Release checksum mismatch: ${name}`);
    return { name, bytes };
  });
  const pluginRoot = fs.realpathSync(path.join(vault, ".obsidian", "plugins"));
  const target = fs.realpathSync(path.join(pluginRoot, manifest.id));
  if (path.dirname(target) !== pluginRoot || path.basename(target) !== manifest.id) throw new Error("Unsafe plugin target.");
  for (const name of RELEASE_FILES) {
    const file = path.join(target, name);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Linked plugin file refused: ${name}`);
  }
  const installed = JSON.parse(fs.readFileSync(path.join(target, "manifest.json"), "utf8"));
  if (installed.id !== manifest.id) throw new Error("Installed plugin ID does not match.");
  for (const { name, bytes } of files) fs.writeFileSync(path.join(target, name), bytes);
  return target;
}
if (require.main === module) console.log(deploy(process.argv[2]));
module.exports = { deploy };
