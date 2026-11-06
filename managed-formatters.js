"use strict";

// 固定来源、版本、长度及摘要；不查找 PATH 中未知版本的程序。
const ASSETS = {
  black: { name: "black-26.10.1-win32-x64.exe", size: 14008196,
    url: "https://api.github.com/repos/psf/black/releases/assets/626960746",
    sha256: "9901f869bcfe0df3304ee7a42913dc3a8f6d85ad4feff6f6c30c26bfd7063dd4" },
  clang: { name: "clang-format-23.1.1.wasm", size: 2573116,
    url: "https://cdn.jsdelivr.net/npm/@wasm-fmt/clang-format@23.1.1/clang-format.wasm",
    sha256: "49d98626475dd2e22b9a3245b4bc0d7b1310db7f6c30176a89cc58d1e89b75bc" }
};
async function valid(bytes, asset) {
  const data = new Uint8Array(bytes);
  if (data.byteLength !== asset.size) return false;
  const digest = globalThis.crypto?.subtle
    ? [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data))].map(b => b.toString(16).padStart(2, "0")).join("")
    : require("node:crypto").createHash("sha256").update(data).digest("hex");
  return digest === asset.sha256;
}
function runBlack(executable, config, source, children, execute = require("node:child_process").execFile) {
  return new Promise((resolve, reject) => {
    const child = execute(executable, ["--quiet", "--config", config, "-"], {
      windowsHide: true, shell: false, timeout: 20000, maxBuffer: 1024 * 1024,
      encoding: "utf8", cwd: require("node:path").dirname(executable)
    }, (error, stdout, stderr) => {
      children.delete(child);
      if (error) reject(new Error(`Black 格式化失败（${error.killed ? "超时或已取消" : error.code}）：${String(stderr || error.message).trim().slice(0, 500)}。原代码未修改。`));
      else resolve(stdout);
    });
    children.add(child);
    child.stdin.on("error", () => {}); // 退出后的 EPIPE 由 execFile 回调报告。
    child.stdin.end(source, "utf8");
  });
}
class ManagedFormatters {
  constructor({ adapter, baseDir, request, onStatus = () => {} }) {
    this.adapter = adapter; this.baseDir = baseDir; this.request = request; this.onStatus = onStatus;
    this.pending = new Map(); this.children = new Set(); this.disposed = false;
  }
  check() { if (this.disposed) throw new Error("插件已卸载，操作已取消。"); }
  ensure(asset) {
    this.check();
    if (!this.pending.has(asset.name)) {
      const task = this.load(asset).finally(() => this.pending.delete(asset.name));
      this.pending.set(asset.name, task);
    }
    return this.pending.get(asset.name);
  }
  async load(asset) {
    const adapter = this.adapter, target = `${this.baseDir}/${asset.name}`;
    if (await adapter.exists(target)) {
      const cached = await adapter.readBinary(target);
      if (await valid(cached, asset)) { this.check(); return cached; }
      this.check(); await adapter.remove(target);
    }
    this.check(); this.onStatus("首次使用：正在下载并校验格式化组件…");
    let timer;
    let response;
    try {
      response = await Promise.race([
        this.request({ url: asset.url, headers: { Accept: "application/octet-stream" }, throw: false }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("组件下载超时，请检查网络后重试。")), 90000); })
      ]);
    } catch (error) { throw new Error(`格式化组件下载失败：${error.message}。请检查网络后重试；原代码未修改。`); }
    finally { clearTimeout(timer); }
    this.check();
    if (response.status !== 200) throw new Error(`格式化组件下载失败（HTTP ${response.status}），请检查网络后重试；原代码未修改。`);
    if (!await valid(response.arrayBuffer, asset)) throw new Error("格式化组件校验失败，未安装。请稍后重试；原代码未修改。");
    this.check();
    if (!await adapter.exists(this.baseDir)) await adapter.mkdir(this.baseDir);
    const part = `${target}.${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
    try {
      this.check(); await adapter.writeBinary(part, response.arrayBuffer);
      this.check(); await adapter.rename(part, target);
      this.check(); return response.arrayBuffer;
    } finally { if (await adapter.exists(part)) await adapter.remove(part); }
  }
  async format(source, language, formatClang) {
    this.check();
    if (["python", "py"].includes(language)) {
      if (typeof process === "undefined" || process.platform !== "win32" || process.arch !== "x64" || !this.adapter.getBasePath) {
        throw new Error("Python 格式化目前支持 Windows x64 桌面版；当前平台尚未适配。原代码未修改。");
      }
      this.blackSetup ??= this.setupBlack().catch(error => { this.blackSetup = null; throw error; });
      const worker = await this.blackSetup; this.check();
      this.onStatus("正在使用 Black 格式化…");
      return worker.format(source);
    }
    const wasm = await this.ensure(ASSETS.clang); this.check();
    this.onStatus("正在使用 clang-format 格式化…");
    return formatClang(source, language, new Uint8Array(wasm));
  }
  async setupBlack() {
    const { runtime, wheels } = require("./black-runtime-assets.js");
    const bytes = await this.ensure(runtime);
    const archives = [];
    for (const wheel of wheels) { archives.push(await this.ensure(wheel)); this.check(); }
    const directory = `${this.baseDir}/python-3.14.10-win32-x64`;
    this.onStatus("正在初始化 Python 格式化组件…");
    await this.unpack(bytes, directory);
    const packages = `${this.baseDir}/black-26.10.1-packages-v1`;
    for (const archive of archives) await this.unpack(archive, packages);
    this.check();
    const path = require("node:path"), root = this.adapter.getBasePath();
    const { BlackWorker } = require("./black-worker.js");
    this.blackWorker = new BlackWorker({ executable: path.join(root, directory, "python.exe"),
      wheels: [path.join(root, packages)] });
    return this.blackWorker;
  }
  async unpack(bytes, directory) {
    const files = require("fflate").unzipSync(new Uint8Array(bytes));
    if (Object.keys(files).some(name => name.startsWith("/") || name.includes("\\") || name.includes(":") || name.split("/").includes("..")) ||
        Object.values(files).reduce((size, data) => size + data.length, 0) > 60000000) throw new Error("Python 组件目录无效，已取消。");
    const mkdir = async name => { this.check(); if (!await this.adapter.exists(name)) await this.adapter.mkdir(name); };
    await mkdir(directory);
    for (const [name, data] of Object.entries(files)) {
      this.check();
      if (name.endsWith("/")) continue;
      const parts = name.split("/"); parts.pop(); let parent = directory;
      for (const part of parts) { parent += "/" + part; await mkdir(parent); }
      const target = `${directory}/${name}`;
      let matches = false;
      if (await this.adapter.exists(target)) {
        const cached = new Uint8Array(await this.adapter.readBinary(target));
        matches = cached.length === data.length && cached.every((byte, i) => byte === data[i]);
      }
      if (!matches) await this.adapter.writeBinary(target, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
  }
  dispose() {
    this.disposed = true;
    this.blackWorker?.dispose();
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}
module.exports = { ManagedFormatters, ASSETS, runBlack };
