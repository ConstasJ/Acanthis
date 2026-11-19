# Acanthis EPUB 引擎与导出 CLI 设计文档

## 1. 背景与意图（Intent & Why）

在第一步底座能力（CORS、正文插图受控代理缓存、书库列表、章节直链兜底、隐藏章节双向推导）就绪后，第二步需要交付两个紧密协作的模块：

1. **`@acanthis-dec/epub`（`packages/epub`）**：平台无关的标准 EPUB 3 内存组装引擎，供 CLI 与后续第三步的在线 Web 客户端共同复用；
2. **`@acanthis-dec/cli`（`apps/cli`）**：面向自动化脚本与终端人类用户的双模命令行工具，连接 `@acanthis-dec/api-server` 将轻小说按分卷或整书合集导出为离线 EPUB 电子书，并同时支持 **npm 轻量包** 与 **GitHub Release 单文件二进制（配套 WinGet / Homebrew 清单）** 双轨分发。

## 2. 目标与非目标（Goals, Non-Goals & Anti-Goals）

### Goals

1. **零 Node 耦合的 `@acanthis-dec/epub` 包**：纯内存 `Uint8Array` 输入输出，产出符合 EPUB 3.0 规范（并向后兼容 EPUB 2 NCX 目录及封面元数据）的电子书二进制数据，支持单卷成书与整书多卷合集两种结构。
2. **严格的 HTML -> XHTML 清洗与排版**：自动处理章节首标题去重、命名 HTML 实体（如 `&nbsp;`）转 UTF-8 字符、空标签自闭合、插图离线打包路径重写及日系轻小说样式表内嵌。
3. **双模 CLI（自动化参数 + 终端交互向导）**：完整参数或非 TTY 环境下静默/结构化执行（支持 `--json` 与明确退出码）；TTY 缺省参数时启动交互向导（浏览服务端书库 / 搜索作品 -> 勾选分卷 -> 选择拆卷或合集 -> 实时进度展示）。
4. **双轨分发流水线**：
   - **npm 渠道**：通过现有 Changesets 发布极轻量的纯 ESM 包（`npx @acanthis-dec/cli` / `npm i -g @acanthis-dec/cli`）；
   - **单文件二进制渠道**：监听 `@acanthis-dec/cli@*` Git tag，使用 `bun build --compile` 交叉编译 Windows / Linux / macOS 单文件可执行程序上传至 GitHub Release（含 `SHA256SUMS.txt`），自动生成标准 **WinGet** 与 **Homebrew Formula** 清单并支持条件化自动推送更新。

### Non-Goals

- **不包含本地直连爬虫模式（`--direct`）**：CLI 不引入 `@acanthis-dec/linovelib`、`impers`、`isolated-vm`、`onnxruntime-node` 等重型原生或 V8 绑定包，所有抓取与缓存统一由 `@acanthis-dec/api-server` 承担。
- **不维护自定义 Shell/PowerShell 安装脚本**：不编写 `install.sh` 或 `install.ps1`，单文件安装统一走 GitHub Release 直下、WinGet 或 Homebrew Tap。
- 本阶段不涉及 Web 客户端 UI（留待第三步）。

### Anti-Goals

- **禁止在 `packages/epub` 中引入 Node 专属 API**（如 `node:fs`、`node:path`、`node:crypto`、全局 `Buffer`），必须保证后续浏览器端无需 polyfill 即可直接打包运行。
- **禁止在 `apps/cli` 中引入任何 C++/N-API/FFI 原生扩展**，确保 `bun build --compile` 跨平台交叉编译 100% 纯净可用。
- **禁止对章节正文发起高并发请求轰炸服务端**：服务端 `NovelChapterQueue` 为单并发串行队列，CLI 拉取章节必须串行（`concurrency = 1`）以避免排队请求超时；仅对已去重的封面与插图二进制采用受控并发（默认 `4`）。

## 3. 约束条件（Constraints）

- **构建与 CI 兼容**：仓库现有 `ci.yml` 的 `quality` 任务仅安装 Node 24 与 `pnpm`。因此 `apps/cli` 的默认 `pnpm build` 脚本必须基于 `tsdown`（Node 下直接通过 `turbo run build`），单文件编译拆分为独立的 `build:bin` 脚本并在专属 Release 工作流中通过 `oven-sh/setup-bun` 执行。
- **依赖前置**：依赖第一步底座设计文档（`2026-11-19-foundation-enhancements-design.md`）定义的 `/v1/linovelib/novels`、`/v1/linovelib/chapter/:chapterId?novelId=` 与 `/v1/linovelib/illustration/:hash` 接口。
- **TypeScript 与代码规范**：延续严格 TS 配置、Zod 运行时校验与 Biome（Tab 缩进、双引号）规范。

## 4. 备选方案权衡（Approaches）

| 维度             | 方案 1：独立 `packages/epub` + npm 纯 JS + GH Release 单二进制（已选定） | 方案 2：EPUB 逻辑内聚于 `apps/cli`       | 方案 3：npm 通过 `optionalDependencies` 分发二进制 |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------- |
| Web 端复用能力   | 浏览器可直接导入 `@acanthis-dec/epub` 离线生成 EPUB                      | 第三步需二次拆包重构或被迫改为服务端打包 | 同左（若拆包）                                     |
| npm 安装体积     | 几十 KB 纯 JS，秒装秒用                                                  | 几十 KB 纯 JS                            | 需额外维护 5 个平台子包，每次下载 60~90MB          |
| 无 Node 用户体验 | GitHub Release 单文件 + WinGet / Homebrew 原生安装                       | 同左                                     | 同左                                               |
| 维护复杂度       | 清晰分离库包、CLI 与 `cli-release.yml`                                   | 前期少一个包，后期返工                   | npm 多包发布矩阵繁琐                               |

**用户决策**：采纳 **方案 1**，单文件渠道采用 **GitHub Release + WinGet / Homebrew 清单**（不提供安装脚本）。

## 5. 详细设计（Detailed Design）

### 5.1 `@acanthis-dec/epub`（`packages/epub`）

#### 1) 包配置与依赖边界

- **发布配置**：公开 npm 包，`"exports": { ".": "./src/index.ts" }`，`publishConfig` 输出 `./dist/index.mjs` 与 `./dist/index.d.mts`。
- **构建与类型约束**：
  - `tsdown.config.ts` 继承 `@acanthis-dec/config-tsdown` 的 `baseConfig` 并覆盖 `platform: "neutral"`；
  - `tsconfig.json` 继承 `@acanthis-dec/config-typescript/libraries.json` 并显式覆盖 `"compilerOptions": { "types": [] }`，从编译期阻断 Node 全局类型混入。
- **运行时依赖**：
  - `@acanthis-dec/core`（共享模型类型）
  - `fflate`（纯 JS ZIP 打包，支持单条目指定 `level: 0` 无压缩存储）
  - `htmlparser2`、`domhandler`、`dom-serializer`（纯 JS HTML 解析与严格 XML 序列化）

#### 2) 公开接口与数据模型

```ts
export interface EpubImageAsset {
	/** 原始或服务端重写后的匹配键 URL（与章节 HTML 中 <img src> 一致） */
	sourceUrl: string;
	data: Uint8Array;
	mimeType: string;
}

export interface EpubChapterData {
	id: string;
	title: string;
	html: string;
}

export interface EpubVolumeData {
	id: string;
	title: string;
	cover?: EpubImageAsset | undefined;
	chapters: EpubChapterData[];
}

export interface VolumeEpubInput {
	identifier: string; // 如 urn:acanthis:linovelib:1234:vol:5678
	novelTitle: string;
	volumeTitle: string;
	author: string;
	language?: string | undefined; // 默认 "zh-CN"
	summary?: string | undefined;
	genres?: string[] | undefined;
	modifiedAt?: Date | undefined;
	cover?: EpubImageAsset | undefined; // 优先分卷封面，回退作品封面
	chapters: EpubChapterData[];
	illustrations: EpubImageAsset[];
}

export interface NovelEpubInput {
	identifier: string; // 如 urn:acanthis:linovelib:1234
	title: string;
	author: string;
	language?: string | undefined; // 默认 "zh-CN"
	summary?: string | undefined;
	genres?: string[] | undefined;
	modifiedAt?: Date | undefined;
	cover?: EpubImageAsset | undefined;
	volumes: EpubVolumeData[];
	illustrations: EpubImageAsset[];
}

export function buildVolumeEpub(input: VolumeEpubInput): Uint8Array;
export function buildNovelEpub(input: NovelEpubInput): Uint8Array;
```

#### 3) EPUB 3 归档结构与 XHTML 转换规则

1. **ZIP 首条目规范**：归档第一个键固定为 `mimetype`，内容为 ASCII `"application/epub+zip"`，压缩级别强制设为 `{ level: 0 }`（不压缩）；其余条目使用默认 Deflate 压缩（图片二进制如 `.jpg`/`.png`/`.webp` 本身已压缩，可设 `level: 0` 提升打包速度）。
2. **目录与兼容层**：
   - `META-INF/container.xml` 指向 `OEBPS/content.opf`。
   - `OEBPS/nav.xhtml`（EPUB 3 Navigation Document，`properties="nav"`）：单卷模式生成一维章节列表；整书模式生成“分卷标题页 -> 卷内各章”二级嵌套 `<ol>`。
   - `OEBPS/toc.ncx`：同步生成 EPUB 2 NCX 导航树并在 `<spine toc="ncx">` 关联，确保老款 Kindle / KOReader 阅读器完整识别分卷层级目录。
   - 整书模式下，每个分卷在章节前生成独立的分卷扉页 `OEBPS/text/vol-XXX.xhtml`（展示分卷标题及可选的分卷封面图）。
3. **正文 XHTML 规范化**：
   - 使用 `htmlparser2.parseDocument(html, { decodeEntities: true })` 解析片段，将 `&nbsp;` 等 HTML 命名实体解码为标准 Unicode 字符（`\u00A0`），彻底规避 XML 阅读器报 `Entity 'nbsp' not defined` 致命错误。
   - **首标题去重**：检查首个元素节点；若已是 `<h1>`/`<h2>`/`<h3>`（如 `linovelib` 章节自带的 `<h2>章节名</h2>`），将其统一转换为 `<h1 class="chapter-title">` 保留，不再重复前置 `chapter.title`；若片段无首标题元素则自动补上 `<h1 class="chapter-title">`。
   - **插图重写与容错**：遍历 `<img>` 节点，若 `src` 命中已下载的 `illustrations` 映射表（相同图片跨章节去重复用同一个 `OEBPS/images/img-XXXX.<ext>` 清单条目），重写为相对路径 `../images/img-XXXX.<ext>` 并确保存在 `alt` 属性；若某张插图未下载成功（或被 `--no-illustrations` 跳过），移除该 `<img>` 并替换为 `<p class="image-placeholder">[插图未包含]</p>`，防止离线阅读器请求外链卡顿或无法通过 EPUB 校验。
   - 移除潜在危险/非法节点（`script`、`iframe`、`style` 标签及 `on*` 事件属性），最后通过 `dom-serializer` 的 `render(nodes, { xmlMode: true, encodeEntities: "utf8" })` 序列化为严格闭合的 XHTML 1.1 / EPUB 3 文档。
4. **内嵌样式表（`OEBPS/styles/main.css`）**：提供克制的日系轻小说默认排版样式（正文段首缩进与段距、`<ruby><rt>` 振假名对齐、封面与全幅插图 `max-width: 100%; max-height: 100vh; object-fit: contain` 自适应且不跨页截断）。

### 5.2 `@acanthis-dec/cli`（`apps/cli`）

#### 1) 命令体系与双模交互

可执行命令名为 `acanthis`（基于纯 ESM 的 `citty` 解析命令行参数，`@clack/prompts` + `picocolors` 提供终端交互与进度展示）：

- `acanthis`（无子命令）：
  - 若 `process.stdin.isTTY && process.stdout.isTTY`：进入交互式向导——检查服务端连通性（不可达时引导输入并可选保存 `serverUrl`）-> 选择入口（浏览服务端已缓存书库 / 搜索关键词 / 直接输入作品 ID 或 URL）-> 多选目标分卷 -> 选择导出模式（按分卷独立导出 `split` / 整书合并导出 `merged`）-> 确认输出目录 -> 执行下载打包并打印完成摘要。
  - 若非 TTY 环境：打印帮助信息并以退出码 `1` 退出。
- `acanthis export <novelIdOrUrl>`（核心导出命令）：
  - `<novelIdOrUrl>` 支持纯数字 ID（如 `3590`）或完整作品链接（如 `https://www.linovelib.com/novel/3590.html`）。
  - 选项：
    - `-s, --server <url>`：指定 `api-server` 基础地址（如 `http://localhost:5301`）
    - `--source <platform>`：指定服务端书源标识（默认 `"linovelib"`，可通过 `acanthis sources` 或交互模式从 `GET /v1/sources` 动态获取）
    - `-t, --token <token>`：可选访问令牌（服务端启用 `AUTH_TOKEN` 时附带 `Authorization: Bearer <token>`）
    - `-o, --output <dir>`：输出目录
    - `-m, --mode <split|merged>`：导出粒度，`split` 为每卷生成一个 `.epub`，`merged` 为所选分卷合并为单个 `.epub`（默认 `split`，因轻小说通常按卷阅读且单卷插图体积适中；提供 `--merged` 快捷开关等价于 `--mode merged`）
    - `-v, --volumes <spec>`：按 1 基序号范围或分卷 ID 筛选（如 `-v 1,3-5`）
    - `--no-illustrations`：仅包含封面，跳过章节内嵌插图下载
    - `--strict`：遇到未决章节（`id` 以 `"TOBEDETERMINED"` 开头）或单章/单图重试耗尽时立即以非零退出码中止（默认非严格模式下记录警告并跳过未决章节）
    - `--overwrite`：覆盖同名已存在的 `.epub` 文件
    - `--json`：标准输出仅打印最终结构化 JSON 结果（进度与日志走 `stderr` 或静默），便于自动化脚本消费
- `acanthis search <keyword>`（支持 `-s, --server`、`--source`、`-t, --token`、`--json`）
- `acanthis list`（调用 `/v1/:source/novels`，支持 `--page`、`--page-size`、`-s, --server`、`--source`、`-t, --token`、`--json`）
- `acanthis sources`（调用 `/v1/sources` 列出当前服务端支持的书源，支持 `--json`）
- `acanthis info <novelIdOrUrl>`（展示作品详情、各分卷 1 基序号、章节数及未决章节提示，支持 `--source`、`--json`）
- `acanthis config <get|set|list|reset|path>`（管理持久化配置：`serverUrl`、`token`、`defaultSource`、`outputDir`）

#### 2) 配置优先级与服务端地址重定基（URL Rebasing）

- **配置优先级**：CLI 显式参数 > 环境变量（`ACANTHIS_SERVER_URL`、`ACANTHIS_API_TOKEN`、`ACANTHIS_SOURCE`、`ACANTHIS_OUTPUT_DIR`） > 用户配置文件（Windows 为 `%APPDATA%\acanthis\config.json`，macOS/Linux 遵循 `${XDG_CONFIG_HOME:-~/.config}/acanthis/config.json`） > 默认值（`serverUrl: "http://localhost:5301"`、`defaultSource: "linovelib"`、`outputDir: "."`）。
- **[工程决策] 服务端媒体链接重定基（防 Docker `HOST` 漏配）**：当服务端未正确配置对外 `HOST` 环境变量时，其返回的封面或插图链接前缀可能是 `http://localhost:5301/v1/<source>/...`。CLI 的 API 客户端在请求封面与插图时，只要检测到 URL 路径以 `/v1/` 开头，统一将其协议与主机部分替换为当前生效的 `serverUrl`，同时保留章节 HTML 中的原始 `src` 字符串作为 `EpubImageAsset.sourceUrl` 匹配键。这样即使服务端反代后未改 `HOST` 配置，远程 CLI 依然能 100% 正常拉取所有封面与插图。

#### 3) 拉取调度与文件名规范

- **章节拉取**：按顺序 `concurrency = 1` 请求 `GET /v1/linovelib/chapter/:chapterId?novelId=:novelId`，单章失败自动指数退避重试最多 3 次。
- **图片拉取**：汇总目标范围内所有封面与章节插图 URL 去重后，以默认 `concurrency = 4` 并发拉取二进制并缓存于本次任务的内存池中（合并模式或多章共用插图仅下载一次）。
- **输出文件名清洗**：
  - `split` 模式：`[作者] 书名 - 分卷名.epub`
  - `merged` 模式：`[作者] 书名.epub`（若通过 `--volumes` 仅选了部分分卷则为 `[作者] 书名 (选集).epub`）
  - 统一过滤跨平台非法文件名字符（`<>:"/\|?*` 及控制字符）并截断末尾空格与句点。

### 5.3 双轨构建、GitHub Release 与 WinGet / Homebrew 清单

#### 1) 包构建脚本（`apps/cli/package.json`）

- `build`：使用 `tsdown` 输出 `dist/index.mjs`（注入 `#!/usr/bin/env node`），由 `pnpm release` 发布至 npm；`@acanthis-dec/core` 与 `@acanthis-dec/epub` 作为公开工作区依赖随 Changesets 协同发版。
- `build:bin`：`bun build ./src/index.ts --compile --minify --outfile ./dist/acanthis`，供本地或 CI 单文件打包使用。

#### 2) 多平台单二进制发布工作流（`.github/workflows/cli-release.yml`）

参照现有 `docker-release.yml` 模式，监听 tag push `"@acanthis-dec/cli@*"` 及 `workflow_dispatch`：

1. **编译与归档 Job（`build-binaries`，运行于 `ubuntu-latest` + `oven-sh/setup-bun`）**：
   读取 `apps/cli/package.json` 的 `version`，依次使用 `bun build --compile --minify` 交叉编译 5 个目标并打包：
   - `bun-windows-x64` -> `acanthis.exe` -> `acanthis-v${VERSION}-windows-x64.zip`
   - `bun-linux-x64` -> `acanthis` -> `acanthis-v${VERSION}-linux-x64.tar.gz`
   - `bun-linux-arm64` -> `acanthis` -> `acanthis-v${VERSION}-linux-arm64.tar.gz`
   - `bun-darwin-arm64` -> `acanthis` -> `acanthis-v${VERSION}-darwin-arm64.tar.gz`
   - `bun-darwin-x64` -> `acanthis` -> `acanthis-v${VERSION}-darwin-x64.tar.gz`
     计算全部归档的 SHA-256 生成 `SHA256SUMS.txt`。
2. **包管理器清单生成脚本（`apps/cli/scripts/generate-manifests.ts`）**：
   输入版本号、仓库地址与 `SHA256SUMS.txt`，确定性地生成两套标准清单产物（同时作为 Release 附件或 CI Artifact 留存，便于人工核验或首次手动提 PR）：
   - **Homebrew Formula（`Formula/acanthis.rb`）**：根据 `on_macos` / `on_linux` 与 `Hardware::CPU.arm?` / `intel?` 分别指向对应的 4 个 `.tar.gz` Release 下载链接与 `sha256`，安装 `bin.install "acanthis"` 并附带 `test { assert_match version.to_s, shell_output("#{bin}/acanthis --version") }`。
   - **WinGet 多文件清单（`manifests/c/ConstasJ/Acanthis/${VERSION}/`）**：生成符合 WinGet Schema 的版本清单、语言清单（`zh-CN` / `en-US`）与安装器清单（`InstallerType: zip`、`NestedInstallerType: portable`、`NestedInstallerFiles: [{ RelativeFilePath: acanthis.exe, PortableCommandAlias: acanthis }]`，填入 `acanthis-v${VERSION}-windows-x64.zip` 的 URL 与 `InstallerSha256`）。
3. **发布与自动同步 Job**：
   - 将 5 个平台压缩包与 `SHA256SUMS.txt` 上传至对应 tag 的 GitHub Release；
   - **Homebrew Tap 自动更新**（条件触发：`if: vars.HOMEBREW_TAP_REPO != '' && secrets.PACKAGE_MANAGER_TOKEN != ''`）：检出用户的 Tap 仓库（如 `ConstasJ/homebrew-tap`），覆写提交 `Formula/acanthis.rb`；
   - **WinGet 自动提交**（条件触发：`if: vars.ENABLE_WINGET_RELEASE == 'true' && secrets.WINGET_TOKEN != ''`）：调用 `vedantmgoyal9/winget-releaser`（或在首次收录前先产出完整 `manifests/` Artifact 供首次提交 `microsoft/winget-pkgs`）。
4. **同步更新 `ci.yml` 路径检测**：在 `.github/workflows/ci.yml` 的 `changes` 过滤器中补充 `packages/epub` 与 `apps/cli` 相关路径（保持 `quality` 与 `release` 任务自动覆盖新包）。

## 6. 留给实施阶段自行决定的细节（Left to the Builder）

- `packages/epub` 内部文件组织（如拆分为 `opf.ts`、`xhtml.ts`、`nav.ts`、`ncx.ts`、`styles.ts`、`archive.ts`）及默认 CSS 的具体字号/边距数值。
- `apps/cli` 内部子命令目录结构、HTTP 客户端封装细节及终端提示文案润色。
- `acanthis config` 读写 JSON 时的原子写入实现细节。
