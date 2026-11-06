"use strict";
const VERSION = "26.10.1";
function script(wheels) {
  return `import sys,json,contextlib
sys.path[:0]=${JSON.stringify(wheels)}
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
import black
output=sys.stdout
print(json.dumps({"ready":black.__version__}),file=output,flush=True)
for raw in sys.stdin:
    request=json.loads(raw)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            try:
                result=black.format_file_contents(request["code"],fast=False,mode=black.Mode())
            except black.NothingChanged:
                result=request["code"]
        response={"id":request["id"],"ok":True,"code":result}
    except Exception as error:
        response={"id":request["id"],"ok":False,"error":str(error)[:500]}
    print(json.dumps(response,ensure_ascii=True),file=output,flush=True)
`;
}
class BlackWorker {
  constructor({ executable, wheels, spawn, timeout = 20000 }) {
    this.executable = executable; this.wheels = wheels; this.spawn = spawn; this.timeout = timeout;
    this.serial = 0; this.disposed = false;
  }
  start() {
    if (this.disposed) return Promise.reject(new Error("插件已卸载，格式化已取消。"));
    if (this.starting) return this.starting;
    const spawn = this.spawn || require("node:child_process").spawn;
    this.starting = new Promise((resolve, reject) => {
      this.readyResolve = resolve; this.readyReject = reject;
      const child = this.child = spawn(this.executable, ["-I", "-S", "-B", "-u", "-c", script(this.wheels)], {
        windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, BLACK_CACHE_DIR: require("node:path").join(require("node:path").dirname(this.executable), "black-cache") },
        cwd: require("node:path").dirname(this.executable)
      });
      const decoder = new (require("node:string_decoder").StringDecoder)("utf8");
      let buffer = "", stderr = "";
      child.stdout.on("data", bytes => {
        if (this.child !== child) return;
        buffer += decoder.write(bytes);
        if (buffer.length > 6000000) return this.stop(new Error("Black 返回内容过大，已取消。"));
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try { this.receive(JSON.parse(line)); }
          catch { this.stop(new Error("Black 进程返回无效响应，原代码未修改。")); return; }
        }
      });
      child.stderr.on("data", bytes => { stderr = (stderr + bytes.toString("utf8")).slice(-1000); });
      child.stdin.on("error", error => { if (this.child === child) this.stop(new Error(`Black 通信失败：${error.message}`)); });
      child.on("error", error => { if (this.child === child) this.stop(new Error(`Black 启动失败：${error.message}`)); });
      child.on("close", code => { if (this.child === child) this.stop(new Error(`Black 进程已退出（${code}）：${stderr}`)); });
      this.startTimer = setTimeout(() => this.stop(new Error("Black 初始化超时，已取消。")), this.timeout);
    });
    return this.starting;
  }
  receive(message) {
    if (this.readyResolve) {
      if (message.ready !== VERSION) return this.stop(new Error("Black 版本校验失败，原代码未修改。"));
      clearTimeout(this.startTimer); const resolve = this.readyResolve;
      this.readyResolve = this.readyReject = null; resolve(); return;
    }
    const request = this.request;
    if (!request || message.id !== request.id || typeof message.ok !== "boolean") return this.stop(new Error("Black 响应不匹配，原代码未修改。"));
    clearTimeout(request.timer); this.request = null;
    if (message.ok && typeof message.code === "string" && message.code.length <= 1000000) request.resolve(message.code);
    else request.reject(new Error(`Black 格式化失败：${String(message.error || "无效结果").slice(0, 500)}。原代码未修改。`));
    this.idleTimer = setTimeout(() => this.stop(), 5 * 60 * 1000); this.idleTimer.unref?.();
  }
  async format(code) {
    clearTimeout(this.idleTimer);
    await this.start();
    if (this.disposed || !this.child) throw new Error("Black 格式化已取消。");
    if (this.request) throw new Error("Black 正在处理上一个请求，请稍后重试。");
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      this.request = { id, resolve, reject, timer: setTimeout(() => this.stop(new Error("Black 格式化超时，已取消。")), this.timeout) };
      this.child.stdin.write(JSON.stringify({ id, code }) + "\n");
    });
  }
  stop(error = new Error("Black 格式化已取消。")) {
    clearTimeout(this.startTimer); clearTimeout(this.idleTimer);
    const child = this.child; this.child = null; this.starting = null;
    this.readyReject?.(error); this.readyResolve = this.readyReject = null;
    if (this.request) { clearTimeout(this.request.timer); this.request.reject(error); this.request = null; }
    if (child) { child.stdin.end(); child.kill(); }
  }
  dispose() { this.disposed = true; this.stop(new Error("插件已卸载，格式化已取消。")); }
}
module.exports = { BlackWorker };
