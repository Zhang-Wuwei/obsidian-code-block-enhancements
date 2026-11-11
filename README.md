# Code Block Enhancements

Obsidian 代码块增强：软换行后的续行缩进、代码内部结构折叠，以及按钮触发的单块格式化。

Enhance Obsidian code blocks with wrapped-line indentation, structural folding, and manual formatting.

源码仓库 / Source: [Zhang-Wuwei/obsidian-code-block-enhancements](https://github.com/Zhang-Wuwei/obsidian-code-block-enhancements)

当前版本 **[0.4.5 为桌面版公开试用发行](https://github.com/Zhang-Wuwei/obsidian-code-block-enhancements/releases/tag/0.4.5)**，尚未提交官方社区目录。当前依赖下载方案存在上架政策阻断，见[验收与发布状态](docs/release-readiness.md)。

**显示功能不修改 Markdown；只有手动格式化会修改当前代码围栏内部。** 插件沿用 Obsidian 的字体、配色与语法高亮，不自带主题，不执行代码。

## 功能与边界

### 续行缩进

软换行后让续行与原行缩进对齐。开关只控制缩进补偿，不控制自动换行，不向源码插入空格或换行。

插件的显示样式会让代码块软换行；关闭“保留缩进”只取消续行对齐，不恢复横向滚动。

### 代码内部折叠

按类、函数、分支、循环等结构折叠，默认展开；箭头在悬停或聚焦该行时显示，点击省略号展开。

优先使用语言结构解析，覆盖 Java、JS/TS（含 JSX/TSX、mjs/cjs）、Python、C/C++、Go、Rust、HTML、CSS、JSON/JSONC，以及 YAML/yml、SCSS、Less、XML、Markdown/md、SQL、PHP。没有语言解析器的围栏（如 Vue、GraphQL、JSON5、未知或未标记语言）按缩进层级提供后备折叠，忽略空行并按 Tab 列宽计算缩进；没有缩进层次时不生成后备范围。

新增语言的范围：YAML 键值、序列和多行块；SCSS/Less 的规则块；XML 成对标签；Markdown 标题章节、列表、引用及代码块；SQL 语句、括号组和块注释；PHP 有无 `<?php` 的代码块与参数、数组等结构。SQL 不识别所有方言的 `BEGIN/END` 等过程结构；PHP 混合模板目前只解析 PHP 部分，不保证外层 HTML 标签折叠。Markdown 使用 CommonMark AST，不保证识别所有 Obsidian 扩展语法。

缩进后备依赖排版，不保证对应真实语法结构；已有语言解析器时不混入缩进猜测。两种方式都不通过简单括号计数判断范围，不完整教学片段的结果不等于完整 IDE 语义分析。折叠状态只属于显示，不保证跨重启保留。

不要求向 Markdown 写入文件名、行号或自定义围栏参数。

### 格式化当前代码块

点击代码块右上角画刷执行；阅读模式与复制按钮并列，编辑模式固定在代码块开头右侧，不跟随光标。三种视图按钮固定为 32×28px。

- 成功对号保留约 1 秒；移出只隐藏文字提示，不立即清除对号。
- 无变化提示“已格式化”，失败显示叉和就地原因，不弹右上角通知。
- 加载图标在等待超过 300 毫秒后才显示，快速完成时不闪烁。
- 不支持语言显示淡色画刷，悬停或聚焦按钮时变为禁止符号；点击不运行。
- 只处理所点围栏的正文，不整篇重排笔记，不自动触发。
- 校验文件、视图、源码快照、语言与内容，显示过期或定位有歧义时拒绝猜测。
- 实时预览重复 Callout 按容器源码范围定位；阅读模式点击时重新取得当前区段。
- 通过编辑器事务保存并支持撤销；列表、引用和 Callout 保留容器前缀。
- 源码视图中引用围栏的按钮使用 Markdown 结构补充识别，不要求宿主将其标记为代码块。

Prettier 3.7.4 支持下列语言，其中 Java 使用 prettier-plugin-java 2.11.0：

| 类别 | 围栏标记 |
| --- | --- |
| JavaScript | javascript、js、jsx、mjs、cjs |
| TypeScript | typescript、ts、tsx |
| 模板 | html、htm、vue |
| 样式 | css、scss、less |
| 数据 | json、jsonc、json5、yaml、yml |
| 查询 | graphql、gql |
| Java | java |

Python（python、py）使用 Black 26.10.1，目前适配 Windows x64 桌面版。首次使用从 python.org 下载 CPython 3.14.10 嵌入式运行时，从 PyPI 下载固定版本的 Black 及依赖，共约 13.3 MB，无需安装系统 Python。初始化后复用一个隐藏进程，空闲 5 分钟释放；重启后的首次请求仍需要初始化。采用默认行宽 88、4 空格缩进，并保留 Black 的语义与稳定性检查。

C/C++（c、cpp、c++、cc、cxx）使用 @wasm-fmt/clang-format 23.1.1。首次使用从固定版本的 jsDelivr npm CDN 下载约 2.6 MB 的 WASM 组件；采用 LLVM 默认排版（行宽 80、2 空格缩进），保留 include 顺序。

下载前固定组件版本、长度和 SHA-256，校验通过后写入插件私有 components 缓存目录；之后可离线使用。网络或校验失败时不修改代码，可再次点击重试。Java 的两份 WASM 已内嵌，不需下载。Python、C/C++ 不读取笔记目录的格式化配置，也不使用下方 Prettier 选项。Python 其他平台暂未适配，C/C++ 移动端尚未实测。

Go、Rust、日志、text 和未标记语言目前不支持格式化。**支持折叠不代表支持格式化。**

Prettier 不只调整空格，也可能改写换行、引号、分号和尾随逗号等写法，目标是保持程序含义，但没有为所有语言提供独立的语义等价证明。要求逐字保留的代码或输出不要格式化。

“格式化内嵌代码”新安装时默认开启，会深入整理 Vue 内的脚本、样式、插值及可识别的嵌入代码，可能改变标签模板字符串的实际文本和运行结果，必须核对结果。关闭后不深入整理这些内容，只整理外层结构。升级保留已有设置，不强制覆盖用户保存的选择。

## 设置

设置按“代码块显示”与“代码块格式化”分组。格式化区用统一说明卡片列出三种工具：Prettier（含 Java 扩展）、Black（Python）、clang-format（C/C++）；下载条件直接显示，固定风格和后台运行说明可展开查看。下方 16 项偏好只属于 Prettier 及其 Java 扩展，不影响 Python、C/C++。标题与控件统一对齐，较长的支持列表、选项边界和代码示例放在可展开详情中；样式沿用 Obsidian 主题变量，保留全部设置及默认值。

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| 换行后保留缩进 | 开启 | 仅调整软换行后的显示 |
| 代码结构折叠 | 开启 | 提供代码内部折叠 |
| 参考行宽 | 100 | 每行希望大约容纳的字符数；40–200，长字符串等可能超出 |
| 缩进方式 | 空格 | 可选 Tab；部分对齐仍使用空格 |
| 缩进宽度 | 2 | 可选 2、4、8；使用 Tab 时表示对应列宽 |
| 语句末尾添加分号 | 开启 | JS/TS 及 Vue 脚本的语句分号 |
| 字符串引号偏好 | 优先双引号 | 下拉选择双引号或单引号，不表示保留原有引号；为减少转义可能使用另一种引号，JSON、JSX 属性不受此项控制 |
| 末尾逗号 | 所有允许位置 | 包含 JS 函数参数；可选不添加、仅对象和数组等位置，标准 JSON 不添加 |
| 箭头函数参数括号 | 始终添加 | 可选能省则省：移除可省略的参数括号，不表示保留源码原样；语法必需的括号始终保留 |
| 标签每行一个属性 | 关闭 | 开启后 HTML、Vue、JSX 每行一个标签属性；关闭不禁止行宽不足时换行 |
| JSX 属性引号 | 双引号 | 独立控制 JSX/TSX 属性引号 |
| 对象属性名引号 | 仅保留必需引号 | 移除可省引号；可选有属性需引号时统一添加、保留已有情况；不控制字符串值 |
| 对象花括号内空格 | 开启 | `{ name: value }` 与 `{name: value}` |
| 对象换行方式 | 保留已有多行形式 | 可选行宽允许时尽量合并为一行 |
| 多行标签的 > 位置 | 单独下一行 | 可选跟随最后一个属性；仅多行非自闭合开始标签 |
| Vue 脚本和样式额外缩进 | 关闭 | 为 script/style 内部额外缩进一级；与是否深入整理内容分别控制 |
| HTML 标签间空白处理 | 按标签默认显示类型 | 可选全部视为有意义或无意义；不读取实际 CSS |
| 格式化内嵌代码 | 开启 | 深入处理嵌入代码；可能改变模板字符串文本 |

非法行宽不保存，就地提示；失焦恢复已保存值。格式化选项只影响下一次手动格式化，不重新渲染笔记。

发行版暴露的格式化选项默认值与 Prettier 3.7.4 一致，只有参考行宽改为 100（Prettier 原生为 80）。升级保留已保存的个人选择，不把开发者个人偏好写成发行默认值。

## 安装

从发行包取得以下文件，放到 Vault 的 `.obsidian/plugins/code-block-enhancements/`，然后在 Obsidian 中启用插件：

```text
main.js
manifest.json
styles.css
```

`data.json` 是用户设置，不随包分发，升级不要覆盖。

Prettier standalone、Java 解析器及 WASM 已打入 `main.js`。不需要独立的 Obsidian Prettier、Shiki Highlighter 或 VS Code 插件；普通用户不必另外安装 Node.js。Black 与 clang-format 的组件按上述首次使用规则下载，不随三个初始安装文件分发。

仅支持桌面版。已在 Windows / Obsidian 1.14.5 与 1.15.0 验收相关功能；0.4.0 完整验收使用 Windows x64 / Obsidian 1.15.0。其他系统及全部主题／插件组合未穷尽验证；阅读区段查询使用 Obsidian 内部接口，跨版本兼容不能仅凭单元测试保证。

## 开发与发布

需要 Node.js 20+，在仓库根目录运行：

```sh
npm ci --ignore-scripts
npm run check
npm run release
```

`check` 执行语法检查、构建与全部测试，不更新正式 Vault；`release` 先检查，再生成 `dist/<version>/` 与 SHA-256 清单。`package-lock.json` 用于复现依赖，必须保留。

| 文件 | 职责 |
| --- | --- |
| main-source.js | 生命周期、按钮、编辑器与阅读视图适配 |
| folding-entry.js | Lezer 结构范围解析 |
| formatting-entry.js | Markdown AST、Prettier 与写入边界 |
| extra-formatters-entry.js | Java 与 clang-format WASM 的格式化入口 |
| managed-formatters.js | 组件下载、校验、缓存及 Black 隐藏进程 |
| black-worker.js | Black 常驻进程协议、超时、重启及卸载 |
| black-runtime-assets.js | 固定 Python 运行时与 Black wheel 版本及校验值 |
| styles.css | 控件与显示样式，不是高亮主题 |
| build.cjs | 生成 bundle |
| release.cjs / deploy.cjs | 发行白名单、哈希验证与显式部署 |
| *tests.cjs | 显示、格式化、交互、发行及边界测试 |
| test-fixtures/ | 可公开的合成笔记，不是真实知识库 |
| LICENSE / THIRD-PARTY-NOTICES.txt | 自有代码和第三方许可 |

`main.js`、`folding.js`、`formatting.js` 是生成文件，不手改。正式包只需 `main.js`；另外两个 bundle 用于开发测试。

欢迎用中文或英文反馈问题，贡献前请阅读[贡献指南 / Contributing](CONTRIBUTING.md)。详细流程与范围见 [开发与验证](docs/development.md)、[发布检查](docs/releasing.md)、[变更记录](docs/CHANGELOG.md)。功能取舍、外观分工与不能丢失的约束见 [设计决策](docs/design-decisions.md)。

## 已知限制与后续边界

- 不提供文件名标题、插件行号、逐块 wrap 参数、整篇格式化、自动格式化或配色主题。
- 不提供代码执行，也不格式化支持表之外的语言。
- 笔记超过 200 万字符或代码块超过 20 万字符时拒绝格式化；这不是可中断超时保证，目前未使用 Worker。
- 与接管代码块 DOM 的插件可能冲突；不能可靠映射时拒绝写入。
- 引用围栏使用 Markdown AST 补充按钮和正文行识别；不保证覆盖所有第三方插件重写的渲染容器，定位有歧义时拒绝写入。
- 滚动恢复不保证窗口、字体或其他插件同时变化时保持完全相同的视觉位置。
- 既有回归必须保留：围栏 Tab 前缀、卸载取消、异步文本／文件／模式变化、事务 insert 字段、阅读视图保存链路、重复代码定位和反馈隔离。

## 许可与参考

自有代码采用 [MIT License](LICENSE)，作者 ZhangWuwei。第三方许可见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。源码仓库保留这两份文件；构建会把完整声明作为注释嵌入 main.js，确保三个运行文件的发行包仍携带声明，注释不会执行。发行包不另附独立声明文件，重新打包时不得剥离 main.js 内的声明。

- [Obsidian](https://docs.obsidian.md/)
- [CodeMirror](https://codemirror.net/docs/)
- [Lezer](https://lezer.codemirror.net/)
- [Prettier standalone](https://prettier.io/docs/browser)

源码仓库不发布依赖目录、生成 bundle、发行产物、个人设置、真实测试 Vault、备份、模型对话或本机截图。本机历史记录仍保留在原目录但被 Git 忽略，不因整理而删除。

## 网络使用与开发状态

仅首次手动使用 Python 或 C/C++ 格式化且组件未缓存时请求网络：python.org 提供固定 Python 运行时，files.pythonhosted.org 提供固定 Black 及依赖，cdn.jsdelivr.net 提供固定 clang-format WASM。请求用于取得组件，不上传笔记或代码，不包含遥测。组件位于插件目录的 components 缓存中，校验固定长度和 SHA-256 后使用。

本轮开发已收尾，功能暂时冻结，先进行本地使用。远程推送、公开 Release 和官方社区收录另行处理，不因运行打包命令自动执行。新增功能等到新的明确需求再开展。
