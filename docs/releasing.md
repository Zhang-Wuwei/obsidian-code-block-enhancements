# 发布检查

## 当前阶段

当前源码、测试库与正式库均为 0.4.5。源码已公开推送至 GitHub，[0.4.5 Release](https://github.com/Zhang-Wuwei/obsidian-code-block-enhancements/releases/tag/0.4.5) 已作为 Pre-release 公开试用发行，官方社区提交尚未执行。当前首次使用时安装格式化组件的方案存在官方政策阻断，不能将“本地测试通过”写成“可直接上架”。详见[验收与发布状态](release-readiness.md)。

## 版本、分支与标签约定

- `main` 保存通过检查的开发状态；每个提交围绕一个明确问题，提交说明包含改动及验证。较大改动通过分支和 Pull Request 审查。
- 版本采用 `x.y.z`。发布前同步 manifest、package、锁文件、versions.json 和变更记录；仅修改文档或 CI 不递增插件运行版本。
- 每个准备发行的版本建立附注标签，标签必须与 `manifest.version` 完全一致，例如 `0.4.5`，不加 `v`。标签固定后不移动或覆盖；修复发行内容须递增版本。
- 首个公开版本标记为 `0.4.5`；不为缺少源码提交的早期版本倒造历史标签。
- 推送标签只标记源码版本，不自动创建 Release 或上传附件。创建 Release 时明确试用/正式状态，说明变更和已知限制，并附上经校验的三个运行文件及 checksums.json。
- 不使用 `git push --mirror` 或 `--all` 发布；明确推送目标分支与标签，避免把本机备份引用或无关分支带到远端。

## 持续集成与发布顺序

GitHub Actions 在 `main` 推送、Pull Request 和标签推送时，在 Windows / Node.js 24 运行锁定依赖安装、完整 check 和许可核验；标签任务额外核对版本。工作流只读仓库，不持有发布权限，不自动部署知识库。Action 固定提交摘要，升级时核对上游。

顺序为：检查差异和隐私 → 本地 check 与许可检查 → 提交 → 推送并确认 CI → 建立并推送版本标签 → 核对标签 CI → 按授权创建 Release → 按授权处理社区目录。宿主三视图和笔记完整性仍须在本地测试库独立验收，不能用 CI 绿色代替。

标签与附件要求依据 [Obsidian 官方发布说明](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)。源码仓库为 [Zhang-Wuwei/obsidian-code-block-enhancements](https://github.com/Zhang-Wuwei/obsidian-code-block-enhancements)，插件 ID 保持 `code-block-enhancements`；官方要求 ID 不包含 `obsidian`。

## 两种发布范围

源码 Git 仓库：源码、合成测试、构建与发布脚本、锁文件、README、此目录中明确允许的公开文档、LICENSE 和第三方声明。

Obsidian 发行包：仅 main.js、manifest.json、styles.css，另附 checksums.json。LICENSE 和 THIRD-PARTY-NOTICES.txt 仅在源码仓库中作为独立文件保留，全文已嵌入 main.js 注释。不要把源码仓库目录直接复制成插件安装目录。

不发布：node_modules、test-vault、dist、生成的辅助 bundle、data.json、备份、模型对话、审查原始日志、截图、本机规则和用户真实笔记。历史记录原样保留本地，以 .gitignore 排除，不删除用户资料。

## 检查与打包

```sh
npm ci --ignore-scripts
npm run check
npm run release
git status --short
git ls-files --cached --others --exclude-standard
```

核对最后一条命令的候选清单，不依赖“未跟踪”或“已忽略”文字猜范围。首次提交前仍需检查实际 staged diff 和是否有敏感信息；本项目脚本不执行 commit、添加远端或 push。

版本号在 manifest、package、锁文件和 versions.json 中保持一致。打包只接受 x.y.z；同版本相同内容允许重打包，不同内容拒绝覆盖，须先递增版本。构建依赖来自锁文件，不提交整个 node_modules；GitHub Release 附件另行上传 dist 中的文件。

## 部署

用户明确授权后，先备份当前已安装运行文件与设置，再停用插件并执行：

启停或重载插件前，先关闭设置弹出窗口，把目标知识库主窗口置于前台，确认当前正文已经显示。不要在目标窗口隐藏或最小化时连续热重载并立即宣布部署成功。若出现空白，停止后续部署，先保留现场和源码一致性证据；不能通过多次启停掩盖故障。

```sh
npm run deploy -- "目标 Vault 路径"
```

部署只更新匹配 ID 的已安装插件，先校验全部发行文件哈希，不覆盖 data.json。部署完成重新启用，核对版本、文件哈希和 data.json 未变，并在真实知识库做非破坏性显示检查。不以部署成功代替测试。

针对正式库，部署前后记录 Markdown 文件的 SHA-256，确认没有因安装、启停、显示增强而修改笔记。不要在正式笔记上做破坏性格式化测试；围栏内格式化与撤销在独立合成测试库验收。用户已明确的个人偏好若旧设置中尚无对应字段，应单独补齐并记录精确差异，不能用整份测试库 data.json 覆盖正式库设置。

deploy 不是跨文件原子事务；断电、磁盘空间不足或杀毒拦截导致中断时，保持停用、检查并重新部署完整已校验包，必要时从备份恢复。不要混用不同版本文件。

## 许可

自有代码为 MIT；第三方声明覆盖内置依赖，不能用自有 LICENSE 替代。社区安装器只下载 main.js、manifest.json、styles.css，因此构建会把 LICENSE 和 THIRD-PARTY-NOTICES.txt 的全文嵌入 main.js 的行注释；测试逐字核对嵌入内容，并运行真实 bundle。独立声明文件仅保留在源码仓库中，不随运行包分发。若另行压缩或重新打包，须确保 main.js 内的完整声明未被剥离。
