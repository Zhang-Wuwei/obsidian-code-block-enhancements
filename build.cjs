"use strict";
const esbuild = require("esbuild");
const path = require("node:path");
const fs = require("node:fs");
const plugin = __dirname;
const hostModules = ["obsidian", "@codemirror/autocomplete", "@codemirror/commands", "@codemirror/language", "@codemirror/state", "@codemirror/view", "@codemirror/search", "@codemirror/lint", "@lezer/common", "@lezer/lr", "@lezer/highlight"];
async function build() {
esbuild.buildSync({ entryPoints: [path.join(__dirname, "folding-entry.js")], bundle: true,
  platform: "browser", format: "cjs", legalComments: "eof", external: [...hostModules, "./formatting.js"], outfile: path.join(plugin, "folding.js") });
await esbuild.build({ entryPoints: [path.join(__dirname, "formatting-entry.js")], bundle: true,
  platform: "neutral", mainFields: ["module", "main"], format: "cjs", legalComments: "eof", outfile: path.join(plugin, "formatting.js"),
  external: ["fs", "fs/promises", "path", "url", "module"], loader: { ".wasm": "binary" },
  alias: { "prettier/doc": path.join(plugin, "node_modules/prettier/doc.js") },
  plugins: [{ name: "inline-java-resources", setup(build) {
    build.onResolve({ filter: /^prettier$/ }, () => ({ path: path.join(plugin, "node_modules/prettier/standalone.mjs") }));
    build.onResolve({ filter: /^cbe-wasm:/ }, args => ({ path: path.join(plugin, "node_modules", args.path === "cbe-wasm:core"
      ? "web-tree-sitter/web-tree-sitter.wasm" : "prettier-plugin-java/dist/tree-sitter-java_orchard.wasm") }));
    build.onLoad({ filter: /prettier-plugin-java[\\/]dist[\\/]index\.cjs$/ }, args => {
      let contents = fs.readFileSync(args.path, "utf8");
      const init = "await web_tree_sitter.Parser.init();";
      const grammar = 'new URL("./tree-sitter-java_orchard.wasm", require("url").pathToFileURL(__filename).href)';
      if (contents.split(init).length !== 2 || contents.split(grammar).length !== 2) throw Error("Java resource initialization changed; review the version adapter.");
      contents = '// Modified by Code Block Enhancements: inline the two WASM resources; upstream formatter logic unchanged.\n' + contents.replace(init, 'await web_tree_sitter.Parser.init({wasmBinary: require("cbe-wasm:core")});')
        .replace(grammar, 'require("cbe-wasm:grammar")');
      return { contents, loader: "js", resolveDir: path.dirname(args.path) };
    });
  } }]
});
esbuild.buildSync({ entryPoints: [path.join(plugin, "main-source.js")], bundle: true,
  platform: "browser", format: "cjs", legalComments: "eof", external: [...hostModules, "fs", "fs/promises", "path", "url", "module", "node:crypto", "node:path", "node:child_process", "node:string_decoder"],
  outfile: path.join(plugin, "main.js") });

// 社区安装器只获取三个运行文件，完整许可声明须随主 bundle 分发。
const notices = ["LICENSE", "THIRD-PARTY-NOTICES.txt"]
  .map(name => fs.readFileSync(path.join(plugin, name), "utf8").replace(/\r\n/g, "\n").trimEnd()).join("\n\n");
if (/[\u2028\u2029]/.test(notices)) throw new Error("License notices contain unsupported JavaScript line separators.");
fs.appendFileSync(path.join(plugin, "main.js"), "\n// BEGIN CODE BLOCK ENHANCEMENTS LICENSE NOTICES\n" +
  notices.split("\n").map(line => `// ${line}`).join("\n") + "\n// END CODE BLOCK ENHANCEMENTS LICENSE NOTICES\n");
}
build().catch(error => { console.error(error); process.exitCode = 1; });
