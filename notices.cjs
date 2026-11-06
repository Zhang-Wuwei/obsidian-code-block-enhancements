"use strict";
const fs = require("node:fs");
const path = require("node:path");

function collectNotices(root = __dirname) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const groups = new Map();
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location || info.dev || info.optional) continue;
    const name = location.split("node_modules/").pop();
    const directory = path.join(root, location);
    const files = fs.readdirSync(directory).filter(file => /^licen[cs]e(?:[.-]|$)/i.test(file));
    if (!files.length) throw new Error(`Missing license: ${name}`);
    // Prettier ships bundled parser licenses separately from its own MIT license.
    if (name === "prettier") files.push("THIRD-PARTY-NOTICES.md");
    const body = files.map(file => fs.readFileSync(path.join(directory, file), "utf8").replace(/\r\n/g, "\n").trim()).join("\n\n");
    if (!groups.has(body)) groups.set(body, []);
    groups.get(body).push(`${name} ${info.version}`);
  }
  const sections = [...groups].map(([body, names]) => `${names.sort().join("\n")}\n\n${body}`);
  sections.push(fs.readFileSync(path.join(root, "COMPONENT-NOTICES.txt"), "utf8").replace(/\r\n/g, "\n").trim());
  return "Third-party runtime dependency notices\nGenerated from package-lock.json and upstream license files.\nPrettier's bundled-dependency notices are included in full.\n\n" + sections.join("\n\n----------------------------------------\n\n") + "\n";
}
if (require.main === module) {
  const text = collectNotices();
  if (process.argv[2] === "--check") {
    if (fs.readFileSync(path.join(__dirname, "THIRD-PARTY-NOTICES.txt"), "utf8").replace(/\r\n/g, "\n").trimEnd() !== text.trimEnd()) throw new Error("Third-party notices are stale. Regenerate a candidate and review the change.");
    console.log("Third-party notices match installed locked dependencies.");
  } else if (process.argv[2] === "--output" && process.argv[3]) fs.writeFileSync(process.argv[3], text);
  else process.stdout.write(text);
}
module.exports = { collectNotices };
