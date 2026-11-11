# 贡献指南 / Contributing

欢迎用中文或英文提交 Issue 和 Pull Request。请先说明可复现的问题或需求，再讨论较大的实现变更。

Issues and pull requests are welcome in Chinese or English. Discuss substantial changes before implementation.

## 开发与验证 / Development and checks

使用 Node.js 24 和锁文件安装依赖，在独立测试库验证功能：

Use Node.js 24 and the lockfile. Test with synthetic notes in an isolated vault:

```sh
npm ci --ignore-scripts
npm run check
npm run licenses:check
```

- 修改源文件，不手工编辑生成的 bundle。遵守[开发与验证](docs/development.md)中的文件分工。
- 显示与折叠不得修改 Markdown；格式化仅修改用户选择的代码围栏正文。
- 界面变更需在源码、实时预览和阅读视图验证；CI 不运行 Obsidian，不能代替宿主验收。
- 提交前检查 diff，不提交真实笔记、个人设置、凭证、日志或备份。`.gitignore` 不能移除已进入 Git 历史的内容。
- 提交说明写清问题、改动和验证；变更保持单一目的，功能修复需附合适的回归测试。

Edit source files rather than generated bundles. Display and folding must leave Markdown unchanged; formatting must stay inside the selected fence. Verify UI changes in source, live preview and reading views. CI does not run Obsidian. Keep commits focused, explain validation, and never include personal notes, settings, credentials, logs or backups.

## 版本与发布 / Versions and releases

维护者按[发布检查](docs/releasing.md)管理版本、附注标签与发行附件。推送源码、建立标签、创建 GitHub Release、部署本地知识库和提交官方社区目录是分别记录的操作。

Maintainers follow the [release checklist](docs/releasing.md). A source push or version tag does not by itself publish a GitHub Release or submit the plugin to the community directory.
