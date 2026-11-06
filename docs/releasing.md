# 发布检查

## 当前阶段

当前源码与测试库为 0.4.3，正式库为 0.4.2，仅进行桌面版本地试用。远程推送、公开 Release 和官方社区提交尚未执行。当前首次使用时安装格式化组件的方案存在官方政策阻断，不能将“本地测试通过”写成“可直接上架”。详见[验收与发布状态](release-readiness.md)。

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
