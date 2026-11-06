import * as prettier from "prettier/standalone";
import initClang, { format as clangFormat } from "@wasm-fmt/clang-format/web";

export async function formatJava(source, options) {
  const java = require("prettier-plugin-java");
  return prettier.format(source, { ...options, parser: "java", plugins: [java], endOfLine: "lf" });
}
let clangReady;
export async function formatClang(source, language, bytes) {
  clangReady ??= initClang(bytes).catch(error => { clangReady = null; throw error; });
  await clangReady;
  return clangFormat(source, language === "c" ? "snippet.c" : "snippet.cpp",
    JSON.stringify({ BasedOnStyle: "LLVM", SortIncludes: "Never" }));
}
