# Acanthis EPUB 引擎与导出 CLI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建平台无关的纯内存 EPUB 3.0 组装引擎 `@acanthis-dec/epub`（`packages/epub`）、面向自动化脚本与终端交互用户的双模导出工具 `@acanthis-dec/cli`（`apps/cli`），以及 npm + GitHub Release 多平台单二进制 / Homebrew / WinGet 双轨发布流水线。

**Architecture:** `packages/epub` 基于 `fflate` 与 `htmlparser2`/`domhandler`/`dom-serializer` 实现零 Node 耦合的内存级 EPUB 3.0 打包与 HTML->XHTML 清洗，既供 `apps/cli` 本地写盘，也直接向第三步浏览器端 Web Worker 暴露纯 `Uint8Array` 接口。`apps/cli` 严格不引入服务端爬虫或原生扩展，仅通过 HTTP 客户端调用第一步 `@acanthis-dec/api-server` 的多书源/鉴权/书库/章节兜底/代理插图接口（串行拉章 `concurrency = 1` + 去重并发拉图 `concurrency = 4` + 媒体 URL 重定基），并通过 `tsdown`（npm）与 `bun build --compile`（单二进制）双轨交付。

**Tech Stack:** TypeScript 7.0.2（strict、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`）、pnpm 12.21.0 + Turbo、tsdown 0.23.7、Biome 2.6.8、`fflate`、`htmlparser2`、`domhandler`、`dom-serializer`、`citty`、`@clack/prompts`、`picocolors`、`zod`、Bun（单二进制交叉编译）、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-19-epub-and-cli-design.md`（前置依赖第一步实施计划 `docs/superpowers/plans/2026-11-19-foundation-enhancements.md`；向第三步 `docs/superpowers/plans/2026-11-19-web-client.md` 暴露 `@acanthis-dec/epub`）。

## Spec 与当前代码库对齐说明（不改动 Spec 原文）

1. **阻断 Node 类型污染（`packages/epub`）**：仓库共享配置 `tools/config-typescript/libraries.json` 继承自 `base.json`（含 `"types": ["node"]`）。`packages/epub/tsconfig.json` 必须显式覆盖 `"compilerOptions": { "types": [] }` 且 `devDependencies` 不安装 `@types/node`；`packages/epub/tsdown.config.ts` 覆盖 `platform: "neutral"`。
2. **`packages/epub` 与 `@acanthis-dec/core` 依赖关系**：Spec §5.1.1 曾将 `@acanthis-dec/core` 列为依赖，但 Spec §5.1.2 定义的 `EpubImageAsset` / `VolumeEpubInput` / `NovelEpubInput` 与 `core/src/types.ts`（`Novel` / `Volume` / `Chapter`）字段独立且无共享运行时代码。为避免无用依赖与浏览器端额外打包体积，`packages/epub` 保持零工作区运行时依赖，由 `apps/cli`（及第三步 `apps/web`）负责将 `@acanthis-dec/core` 数据映射至 `@acanthis-dec/epub` 输入结构。
3. **`apps/cli` 发布与 `packageManager` 字段**：当前工作区统一声明 `"packageManager": "pnpm@12.21.0"`（而非 `AGENTS.md` 旧写的 `11.6.0`）；`apps/cli/package.json` **严禁设置 `"private": true`**，否则 Changesets（`.changeset/config.json`）不会将其纳入 `pnpm release` npm 发布与 `@acanthis-dec/cli@*` Git tag 触发。
4. **全端点 `:source` 参数化与 `AUTH_TOKEN` 对齐**：Spec §5.2.3 示例路径写 `GET /v1/linovelib/chapter/...`，为与 Spec §5.2.1 `--source` 及第一步、第三步跨计划契约完全一致，CLI HTTP 客户端统一参数化所有书源路径为 `/v1/${encodeURIComponent(source)}/...`（`sources`、`novels`、`search`、`novel/:novelId`、`chapter/:chapterId?novelId=`、`cover/...`），并通过 `-t/--token`（`ACANTHIS_API_TOKEN`）附带 `Authorization: Bearer <token>`。
5. **无封面分卷 `404` 降级容错**：`apps/api-server/src/linovelib.ts` 会对全部分卷无条件生成 `coverUrl`（`${host}/v1/linovelib/cover/volume/${volume.id}`），无封面分卷实际请求返回 `404 { code: 10001, message: "Cover not found" }`。CLI 遇到分卷封面 `404` 时必须容错降级（`split` 回退作品封面，`merged` 置空该卷封面），即使 `--strict` 也不得中断导出。
6. **本地实现 URL 解析与未决章节判定**：`packages/linovelib/src/utils.ts` 的 `extractNovelIdFromUrl` 未对外导出，且 `apps/cli` 严禁依赖 `@acanthis-dec/linovelib`。`apps/cli` 本地实现 `parseNovelIdOrUrl` 与 `isUnresolvedChapterId(id)`（对齐第一步固定前缀 `id.startsWith("TOBEDETERMINED")`）。
7. **服务端遗留错误体兼容**：`apps/api-server/src/linovelib.ts` 部分 404 分支仍返回 `{ error: string }` 而非 `{ code, message }`，CLI 错误解析兼容 `{ code, message }`、`{ error }` 及非 JSON 文本。
8. **CI 过滤器更新**：`.github/workflows/ci.yml` 的 `packages` / `packages-src` 已通配 `packages/*/src/**/*.ts`（注意 `packages-src` 同时触发 `docker-canary`），需补充 `cli` 路径过滤器并将 `.github/workflows/cli-release.yml` 加入 `ci` 过滤器。

---

## Global Constraints

- **包管理与代码规范**：所有新建 `package.json` 声明 `"packageManager": "pnpm@12.21.0"`；格式与 Lint 遵循 `biome.json`（Tab 缩进、双引号、`organizeImports`）；严格 TS 开启 `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`isolatedModules`、`noUncheckedSideEffectImports`。
- **零 Node 耦合（`packages/epub`）**：严禁使用任何 `node:*` 模块或全局 `Buffer`；`tsconfig.json` 必须覆盖 `"types": []` 且不装 `@types/node`；`tsdown.config.ts` 必须设 `platform: "neutral"`，确保浏览器 Web Worker 零 polyfill 可打包运行。
- **纯 JS 无原生扩展（`apps/cli`）**：严禁引入 `@acanthis-dec/linovelib`、`impers`、`isolated-vm`、`onnxruntime-node`、`better-sqlite3` 或任何 C++/N-API/FFI 原生扩展，确保 `bun build --compile` 跨平台交叉编译可用。
- **构建与无测试框架约束**：`apps/cli` 默认 `build` 脚本必须基于 `tsdown`（在 Node 24 下通过 `turbo run build`），单文件编译拆分为独立 `build:bin` 脚本；**严禁引入单元测试框架**，所有 Task 验证必须使用包级 `check-types`、`build`、`pnpm run format-and-lint` 及可复现的端到端实测命令。
- **限流与重试安全**：CLI 拉取章节正文必须严格串行（`concurrency = 1`，单章失败指数退避重试最多 3 次）；仅对已去重的封面与插图二进制采用受控并发（默认 `4`）。
- **EPUB 3.0 归档规范**：ZIP 第一个条目必须为 `mimetype`（ASCII `"application/epub+zip"`，`{ level: 0 }` 无压缩）；同步产出 `OEBPS/nav.xhtml`（EPUB 3）与 `OEBPS/toc.ncx`（EPUB 2）及 `<meta name="cover" content="cover-image" />`；正文 HTML 必须将命名实体解码为 UTF-8（禁止残余 `&nbsp;` 等未定义 XML 实体）、强制闭合标签并清理危险标签与事件属性。
- **跨计划契约**：严格消费第一步 `@acanthis-dec/core`（`NovelSourceDescriptor`、`SourceCapability` 及现有 `Novel` / `NovelInfo` / `NovelSearchResult` / `Volume` / `Chapter`）与 `@acanthis-dec/api-server` 路由/错误码/环境变量；向第三步暴露完整的 `@acanthis-dec/epub` 公开接口。

## Review Focus

1. **无封面分卷触发服务端 `404`（`code: 10001`）**：服务端对无封面分卷仍生成 `/v1/:source/cover/volume/:volumeId`，请求返回 `404`；CLI 在 `split` 模式须回退作品封面、`merged` 模式省略该卷封面，即使开启 `--strict` 也不得中止导出（对应 **Task 6、Task 7** 实测）。
2. **章节 HTML 含命名实体（`&nbsp;`、`&mdash;`）、未闭合空标签（`<br>` / `<hr>` / `<img>`）或首节点自带/缺失标题**：`packages/epub` 必须将命名实体解码为 UTF-8 字符、输出严格 XML 自闭合标签，仅在首元素非 `h1`/`h2`/`h3` 时自动前置 `<h1 class="chapter-title">`（若已有则归一化为 `<h1 class="chapter-title">` 避免双标题）（对应 **Task 2、Task 4** 实测）。
3. **跨章节重复插图、非标准 MIME（含 `; charset=...`）与缺图回退**：多章引用同一 `sourceUrl` 时 `OEBPS/images/` 与 OPF manifest 仅允许注册一次；未下载成功或被 `--no-illustrations` 跳过的 `<img>` 必须替换为 `<p class="image-placeholder">[插图未包含]</p>`，绝不残留外链 `<img>`（对应 **Task 2、Task 4** 实测）。
4. **服务端未配 `HOST` 时的媒体 URL 重定基与 `--source` 参数化**：服务端返回 `http://localhost:5301/v1/<source>/...` 或 `/v1/<source>/...` 时，CLI 发起图片请求须将协议与主机（含反代子路径）重定基到生效的 `serverUrl`，同时保留原始 `<img src>` 字符串作为 `EpubImageAsset.sourceUrl` 匹配键；非默认书源下所有请求均须使用 `--source`（对应 **Task 5、Task 6、Task 7** 实测）。
5. **非 TTY 阻塞、`--json` 污染 stdout、`TOBEDETERMINED` 未决章节与 Windows 非法文件名冲突**：无子命令在非 TTY 环境必须直接打印帮助并以退出码 `1` 退出；`--json` 模式下进度/告警全走 `stderr`，`stdout` 仅输出合法 JSON；`TOBEDETERMINED_*` 章节在默认模式跳过并告警、`--strict` 下非零退出；输出文件名须过滤 `<>:"/\|?*` 与控制字符并截断末尾空格/句点，未传 `--overwrite` 遇同名文件须安全跳过或明确报错（对应 **Task 6、Task 7** 实测）。

---

### Task 1: `packages/epub` 包脚手架与零 Node 编译期门禁

**Files:**
- Create: `packages/epub/package.json`
- Create: `packages/epub/tsconfig.json`
- Create: `packages/epub/tsdown.config.ts`
- Create: `packages/epub/src/types.ts`
- Create: `packages/epub/src/index.ts`
- Modify: `pnpm-lock.yaml`（通过 `pnpm install` 更新）

**Interfaces:**
- Consumes: `@acanthis-dec/config-tsdown` (`baseConfig`), `@acanthis-dec/config-typescript/libraries.json`
- Produces: `@acanthis-dec/epub` 包边界配置与 `packages/epub/src/types.ts` 导出的 5 个公开契约类型：
  - `EpubImageAsset`: `{ sourceUrl: string; data: Uint8Array; mimeType: string }`
  - `EpubChapterData`: `{ id: string; title: string; html: string }`
  - `EpubVolumeData`: `{ id: string; title: string; cover?: EpubImageAsset | undefined; chapters: EpubChapterData[] }`
  - `VolumeEpubInput`: `{ identifier: string; novelTitle: string; volumeTitle: string; author: string; language?: string | undefined; summary?: string | undefined; genres?: string[] | undefined; modifiedAt?: Date | undefined; cover?: EpubImageAsset | undefined; chapters: EpubChapterData[]; illustrations: EpubImageAsset[] }`
  - `NovelEpubInput`: `{ identifier: string; title: string; author: string; language?: string | undefined; summary?: string | undefined; genres?: string[] | undefined; modifiedAt?: Date | undefined; cover?: EpubImageAsset | undefined; volumes: EpubVolumeData[]; illustrations: EpubImageAsset[] }`

- [ ] **Step 1: 创建 `packages/epub/package.json`、`tsconfig.json` 与 `tsdown.config.ts`**

参照 `packages/core/package.json` 创建公开包配置，关键差异字段精确如下：
- `packages/epub/package.json`：`"name": "@acanthis-dec/epub"`、`"version": "0.1.0"`、`"type": "module"`、`"packageManager": "pnpm@12.21.0"`、`"exports": { ".": "./src/index.ts" }`、`"publishConfig": { "types": "./dist/index.d.mts", "exports": { ".": { "import": "./dist/index.mjs", "types": "./dist/index.d.mts" } } }`；`dependencies` 包含 `"dom-serializer": "^2.0.0"`、`"domhandler": "^6.0.1"`、`"fflate": "^0.8.3"`、`"htmlparser2": "^10.1.0"`；`devDependencies` 包含 `"@acanthis-dec/config-tsdown": "workspace:*"`、`"@acanthis-dec/config-typescript": "workspace:*"`、`"tsdown": "catalog:"`、`"tsx": "catalog:"`、`"typescript": "catalog:"`（**禁止加入 `@types/node`**）。
- `packages/epub/tsconfig.json`：继承 `@acanthis-dec/config-typescript/libraries.json`，并显式设置 `"compilerOptions": { "types": [] }` 阻断 `base.json` 的 Node 全局类型。
- `packages/epub/tsdown.config.ts`：展开 `baseConfig` 并覆盖 `platform: "neutral"`。

- [ ] **Step 2: 创建 `packages/epub/src/types.ts` 与初始导出入口 `packages/epub/src/index.ts`**

在 `packages/epub/src/types.ts` 精确声明 `EpubImageAsset`、`EpubChapterData`、`EpubVolumeData`、`VolumeEpubInput`、`NovelEpubInput` 五个接口（可选字段统一显式包含 `| undefined` 以满足 `exactOptionalPropertyTypes`），并在 `packages/epub/src/index.ts` 使用 `export type { ... } from "./types"` 导出。

- [ ] **Step 3: 安装依赖并验证编译期零 Node 门禁**

Run:
```bash
pnpm install
pnpm --filter=@acanthis-dec/epub run check-types
pnpm --filter=@acanthis-dec/epub run build
```
Expected: `tsc --noEmit` 与 `tsdown` 均退出码 `0`，生成 `packages/epub/dist/index.mjs` 与 `packages/epub/dist/index.d.mts`。

验证门禁生效（临时检查，不落盘提交）：在命令行通过管道或临时探针确认若 `src/` 出现 `Buffer` 或 `import "node:fs"` 时 `pnpm --filter=@acanthis-dec/epub run check-types` 会报 TS2304 / TS2307 错误，随后恢复源码保持纯净。

- [ ] **Step 4: Commit**

```bash
git add packages/epub/package.json packages/epub/tsconfig.json packages/epub/tsdown.config.ts packages/epub/src/types.ts packages/epub/src/index.ts pnpm-lock.yaml
git commit -m "feat(epub): 初始化 @acanthis-dec/epub 包脚手架与零 Node 编译期约束" -m "创建 @acanthis-dec/epub 包配置（tsconfig 覆盖 types=[] 且不含 @types/node，tsdown 设 platform=neutral），定义并导出 5 个公开 EPUB 输入与资产契约类型。"
```

---

### Task 2: `packages/epub` HTML -> XHTML 清洗引擎与内嵌轻小说样式表

**Files:**
- Create: `packages/epub/src/styles.ts`
- Create: `packages/epub/src/xhtml.ts`

**Interfaces:**
- Consumes: `EpubImageAsset`, `EpubChapterData` (`packages/epub/src/types.ts`), `htmlparser2`, `domhandler`, `dom-serializer`
- Produces:
  - `packages/epub/src/styles.ts`:
    - `export const DEFAULT_EPUB_CSS: string`
  - `packages/epub/src/xhtml.ts`:
    - `export function escapeXml(text: string): string`
    - `export function resolveImageExtension(mimeType: string, sourceUrl?: string): string`
    - `export function buildCoverPageXhtml(title: string, imageHref: string, language?: string): string`
    - `export function buildVolumeTitlePageXhtml(options: { title: string; language?: string; coverHref?: string | undefined }): string`
    - `export function sanitizeChapterHtmlToXhtml(options: { chapter: EpubChapterData; imageHrefBySourceUrl: ReadonlyMap<string, string>; language?: string }): string`

- [ ] **Step 1: 实现 `packages/epub/src/styles.ts`**

导出 `DEFAULT_EPUB_CSS`，包含：
- 全局正文行高与字体栈、`p` 首行缩进 `2em` 与段距、`h1.chapter-title` 与分卷扉页居中样式；
- `<ruby>` / `<rt>` 振假名对齐样式；
- `.cover-page` 与 `img` 自适应防跨页截断规则（`max-width: 100%; max-height: 100vh; object-fit: contain; break-inside: avoid; page-break-inside: avoid`）；
- `.image-placeholder` 灰阶边框提示样式。

- [ ] **Step 2: 实现 `packages/epub/src/xhtml.ts`**

实现要点（仅用标准 Web/JS API 与 `htmlparser2` / `domhandler` / `dom-serializer`）：
- `escapeXml(text)`：转义 `&`、`<`、`>`、`"`、`'`。
- `resolveImageExtension(mimeType, sourceUrl)`：先按 `;` 分割并 `trim().toLowerCase()` 剥离 MIME 参数（如 `image/jpeg; charset=utf-8` -> `image/jpeg`），映射 `image/jpeg -> jpg`、`image/png -> png`、`image/webp -> webp`、`image/gif -> gif`、`image/svg+xml -> svg`、`image/avif -> avif`；若 MIME 为 `application/octet-stream` 或未知，则回退从 `sourceUrl` 路径扩展名提取（白名单限制，默认 `"jpg"`）。
- `sanitizeChapterHtmlToXhtml` 核心清洗算法：
  1. 调用 `parseDocument(chapter.html, { decodeEntities: true })` 将 `&nbsp;`、`&mdash;` 等全部命名/数字 HTML 实体解码为真实 UTF-8 字符（`\u00A0` 等），禁止保留 XML 未定义实体。
  2. 递归遍历 `domhandler` 节点树：
     - 移除 `script`、`iframe`、`style`、`noscript`、`object`、`embed` 节点；
     - 清理所有元素的 `on*` 事件属性及 `javascript:` URI；
     - 遇到 `<img>` 时读取 `attribs.src`：若命中 `imageHrefBySourceUrl`，将 `attribs` 重写为 `{ src: mappedHref, alt: attribs.alt?.trim() || "插图" }`（相对 `OEBPS/text/` 为 `../images/img-XXXX.<ext>`）；若未命中（下载失败或 `--no-illustrations`），**原地替换**该 `<img>` 为 `<p class="image-placeholder">[插图未包含]</p>`。
  3. **首标题去重与归一化**：查找 `root.children` 中首个非空白文本节点的元素节点；若其 `name` 为 `h1`、`h2` 或 `h3`，就地改为 `name = "h1"` 且设置 `attribs.class = "chapter-title"`（若文本为空则补入 `chapter.title`），不再额外前置标题；否则在最前插入 `<h1 class="chapter-title">${chapter.title}</h1>` 节点。
  4. 使用 `render(doc.children, { xmlMode: true, encodeEntities: "utf8" })` 序列化正文，包装进标准 EPUB 3 XHTML 文档外壳（`xmlns="http://www.w3.org/1999/xhtml"`、`xmlns:epub="http://www.idpf.org/2007/ops"`、`xml:lang`、`lang` 与 `<link rel="stylesheet" type="text/css" href="../styles/main.css" />`）。
- `buildCoverPageXhtml` 与 `buildVolumeTitlePageXhtml`：分别生成标准 XHTML 封面页（`epub:type="cover"`）与分卷扉页（展示标题与可选 `coverHref` 图片）。

- [ ] **Step 3: 类型检查、构建与 XHTML 边界实测（覆盖 Review Focus #2 & #3）**

Run:
```bash
pnpm --filter=@acanthis-dec/epub run check-types
pnpm --filter=@acanthis-dec/epub run build
pnpm --filter=@acanthis-dec/epub exec tsx -e '
import assert from "node:assert/strict";
import { resolveImageExtension, sanitizeChapterHtmlToXhtml } from "./src/xhtml.ts";
assert.equal(resolveImageExtension("image/png; charset=binary"), "png");
const map = new Map([["https://x.test/1.jpg", "../images/img-0001.jpg"]]);
const xhtml1 = sanitizeChapterHtmlToXhtml({
  chapter: { id: "c1", title: "第一章", html: "<h2>第一章</h2><p>你好&nbsp;&mdash;世界<br><hr></p><script>alert(1)</script><img src=\"https://x.test/1.jpg\" onload=\"x()\"><img src=\"https://x.test/missing.jpg\">" },
  imageHrefBySourceUrl: map,
});
assert.ok(!xhtml1.includes("&nbsp;") && !xhtml1.includes("&mdash;") && !xhtml1.includes("<script"));
assert.ok(xhtml1.includes("<h1 class=\"chapter-title\">第一章</h1>") && (xhtml1.match(/chapter-title/g)?.length === 1));
assert.ok(xhtml1.includes("<br/>") && xhtml1.includes("<hr/>"));
assert.ok(xhtml1.includes("src=\"../images/img-0001.jpg\"") && xhtml1.includes("[插图未包含]") && !xhtml1.includes("missing.jpg"));
const xhtml2 = sanitizeChapterHtmlToXhtml({
  chapter: { id: "c2", title: "第二章", html: "<p>无自带标题</p>" },
  imageHrefBySourceUrl: map,
});
assert.ok(xhtml2.includes("<h1 class=\"chapter-title\">第二章</h1>"));
console.log("XHTML sanitizer checks passed");
'
```
Expected: 全部断言通过，输出 `XHTML sanitizer checks passed`。

- [ ] **Step 4: Commit**

```bash
git add packages/epub/src/styles.ts packages/epub/src/xhtml.ts
git commit -m "feat(epub): 实现 HTML 到 XHTML 严格清洗与内嵌轻小说样式表" -m "新增 DEFAULT_EPUB_CSS 轻小说排版样式，实现命名实体 UTF-8 解码、危险标签/事件清理、首标题去重归一化与缺图占位符替换。"
```

---

### Task 3: `packages/epub` OPF / NAV / NCX / Container 元数据生成器

**Files:**
- Create: `packages/epub/src/opf.ts`
- Create: `packages/epub/src/nav.ts`
- Create: `packages/epub/src/ncx.ts`

**Interfaces:**
- Consumes: `escapeXml` (`packages/epub/src/xhtml.ts`)
- Produces:
  - `packages/epub/src/opf.ts`:
    - `export interface OpfManifestItem { id: string; href: string; mediaType: string; properties?: string | undefined }`
    - `export interface OpfSpineItem { idref: string; linear?: boolean | undefined }`
    - `export function buildContainerXml(): string`
    - `export function buildContentOpf(options: { identifier: string; title: string; author: string; language: string; summary?: string | undefined; genres?: string[] | undefined; modifiedAt: Date; coverImageId?: string | undefined; manifest: OpfManifestItem[]; spine: OpfSpineItem[] }): string`
  - `packages/epub/src/nav.ts`:
    - `export interface NavEntry { title: string; href: string; children?: NavEntry[] | undefined }`
    - `export function buildNavXhtml(options: { title: string; language: string; entries: NavEntry[] }): string`
  - `packages/epub/src/ncx.ts`:
    - `export function buildTocNcx(options: { identifier: string; title: string; author: string; entries: NavEntry[] }): string`

- [ ] **Step 1: 实现 `packages/epub/src/opf.ts`**

- `buildContainerXml()` 返回标准 `META-INF/container.xml`，`<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />`。
- `buildContentOpf(...)`：
  - `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">`；
  - `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` 包含 `<dc:identifier id="bookid">`、`<dc:title>`、`<dc:creator>`、`<dc:language>`、可选 `<dc:description>` 与多个 `<dc:subject>`、`<meta property="dcterms:modified">`（格式强制 `YYYY-MM-DDTHH:mm:ssZ`，去除毫秒 `.slice(0, 19) + "Z"`）；
  - 当传入 `coverImageId` 时额外输出 `<meta name="cover" content="${escapeXml(coverImageId)}" />` 以兼容 EPUB 2 阅读器；
  - `<manifest>` 渲染所有资源条目（支持 `properties="nav"`、`properties="cover-image"`）；
  - `<spine toc="ncx">` 渲染阅读顺序（支持 `linear="no"`）。

- [ ] **Step 2: 实现 `packages/epub/src/nav.ts` 与 `packages/epub/src/ncx.ts`**

- `buildNavXhtml`：生成包含 `<nav epub:type="toc" id="toc">` 的 EPUB 3 导航文档；递归渲染 `NavEntry[]` 为 `<ol><li><a href="...">...</a>[子 <ol>]</li></ol>`（单卷模式一维 `<ol>`，整书模式“分卷扉页 -> 卷内各章”二级嵌套 `<ol>`）。
- `buildTocNcx`：生成 EPUB 2 `toc.ncx`（`<meta name="dtb:uid" content="..." />`、`<meta name="dtb:depth" content="1|2" />`），递归生成递增 `playOrder` 的 `<navPoint id="navPoint-N" playOrder="N">` 树。

- [ ] **Step 3: 类型检查与元数据 XML 结构实测**

Run:
```bash
pnpm --filter=@acanthis-dec/epub run check-types
pnpm --filter=@acanthis-dec/epub exec tsx -e '
import assert from "node:assert/strict";
import { buildContainerXml, buildContentOpf } from "./src/opf.ts";
import { buildNavXhtml } from "./src/nav.ts";
import { buildTocNcx } from "./src/ncx.ts";
const opf = buildContentOpf({
  identifier: "urn:acanthis:test:1",
  title: "A & B",
  author: "Author",
  language: "zh-CN",
  modifiedAt: new Date("2026-01-01T00:00:00.123Z"),
  coverImageId: "cover-image",
  manifest: [{ id: "nav", href: "nav.xhtml", mediaType: "application/xhtml+xml", properties: "nav" }],
  spine: [{ idref: "cover" }],
});
assert.ok(opf.includes("A &amp; B") && opf.includes("2026-01-01T00:00:00Z") && opf.includes("<spine toc=\"ncx\">") && opf.includes("name=\"cover\""));
const nav = buildNavXhtml({ title: "T", language: "zh-CN", entries: [{ title: "Vol 1", href: "text/vol-001.xhtml", children: [{ title: "Ch 1", href: "text/ch-001.xhtml" }] }] });
assert.ok(nav.includes("epub:type=\"toc\"") && nav.includes("text/vol-001.xhtml") && nav.includes("text/ch-001.xhtml"));
const ncx = buildTocNcx({ identifier: "urn:acanthis:test:1", title: "T", author: "Author", entries: [{ title: "Vol 1", href: "text/vol-001.xhtml", children: [{ title: "Ch 1", href: "text/ch-001.xhtml" }] }] });
assert.ok(ncx.includes("dtb:depth\" content=\"2\"") && ncx.includes("playOrder=\"2\""));
assert.ok(buildContainerXml().includes("OEBPS/content.opf"));
console.log("OPF/NAV/NCX checks passed");
'
```
Expected: 全部断言通过，输出 `OPF/NAV/NCX checks passed`。

- [ ] **Step 4: Commit**

```bash
git add packages/epub/src/opf.ts packages/epub/src/nav.ts packages/epub/src/ncx.ts
git commit -m "feat(epub): 实现 EPUB 3 OPF、NAV 与兼容 EPUB 2 NCX 生成器" -m "实现 container.xml、content.opf（含 dcterms:modified 与 cover meta）、EPUB 3 nav.xhtml 及 EPUB 2 toc.ncx 一/二维目录树生成。"
```

---

### Task 4: `packages/epub` 内存归档打包器与公开 API（`buildVolumeEpub` / `buildNovelEpub`）

**Files:**
- Create: `packages/epub/src/archive.ts`
- Modify: `packages/epub/src/index.ts`
- Create: `packages/epub/README.md`
- Create: `packages/epub/README.zh-CN.md`

**Interfaces:**
- Consumes: Task 1-3 内部模块及 `fflate` (`strToU8`, `zipSync`, `type Zippable`)
- Produces（`packages/epub/src/index.ts` 对外公开契约，与 `docs/superpowers/specs/2026-11-19-epub-and-cli-design.md` §5.1.2 及 `docs/superpowers/plans/2026-11-19-web-client.md` Task 8 契约逐字一致）：
  - Types: `EpubImageAsset`, `EpubChapterData`, `EpubVolumeData`, `VolumeEpubInput`, `NovelEpubInput`
  - Functions:
    - `export function buildVolumeEpub(input: VolumeEpubInput): Uint8Array`
    - `export function buildNovelEpub(input: NovelEpubInput): Uint8Array`

- [ ] **Step 1: 实现 `packages/epub/src/archive.ts`**

核心打包算法（严禁使用 `Buffer` 或 `node:*`）：
1. **图片去重注册表**：以 `asset.sourceUrl` 为键建立 `Map<string, { manifestId: string; zipPath: string; relativeHref: string; mediaType: string; data: Uint8Array }>`；相同 `sourceUrl` 跨章仅分配一个 `OEBPS/images/img-XXXX.<ext>`（`XXXX` 4 位零填充），确保 OPF manifest 无重复 ID/href（覆盖 Review Focus #3）。
2. **MIME 规范化**：向 OPF 写入 `<item media-type="...">` 时剥离 `; ...` 参数，避免含 `; charset=utf-8` 导致 EPUB 校验失败。
3. **封面与分卷处理**：
   - 若存在主封面 `input.cover`：写入 `OEBPS/images/cover.<ext>`（`id="cover-image"`、`properties="cover-image"`、`{ level: 0 }`）与 `OEBPS/text/cover.xhtml`（置于 spine 首位）。
   - `buildNovelEpub` 中对每个 `volume` 若存在 `volume.cover` 且与主封面或前序分卷封面不同，分配 `OEBPS/images/vol-cover-XXX.<ext>`；为每个分卷生成 `OEBPS/text/vol-XXX.xhtml` 并作为 `NavEntry` 父节点挂接该卷所有章节 `NavEntry`。
   - `buildVolumeEpub` 直接生成一维章节 `NavEntry[]`。
4. **ZIP 条目顺序与压缩级别**：
   - 构造传入 `zipSync` 的对象时，**第一个键必须为 `"mimetype": [strToU8("application/epub+zip"), { level: 0 }]`**；
   - 随后写入 `META-INF/container.xml`、`OEBPS/styles/main.css`、`OEBPS/content.opf`、`OEBPS/nav.xhtml`、`OEBPS/toc.ncx`、所有 `OEBPS/text/*.xhtml`（默认压缩）以及全部图片二进制 `[asset.data, { level: 0 }]`。

- [ ] **Step 2: 更新 `packages/epub/src/index.ts` 并编写 `README.md` / `README.zh-CN.md`**

`packages/epub/src/index.ts` 导出 `buildVolumeEpub`、`buildNovelEpub` 与 5 个公开类型；补充双语 README（列出公开 API 与无 Node 约束说明）。

- [ ] **Step 3: 包级构建、Lint 与 ZIP 二进制结构端到端实测（覆盖 Review Focus #2 & #3）**

Run:
```bash
pnpm --filter=@acanthis-dec/epub run check-types
pnpm --filter=@acanthis-dec/epub run build
pnpm run format-and-lint
pnpm --filter=@acanthis-dec/epub exec tsx -e '
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { buildNovelEpub, buildVolumeEpub } from "./dist/index.mjs";
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const sharedImg = { sourceUrl: "http://host/v1/linovelib/illustration/abc", data: pngBytes, mimeType: "image/png; charset=binary" };
const volBuf = buildVolumeEpub({
  identifier: "urn:acanthis:linovelib:1:vol:10",
  novelTitle: "Test Novel",
  volumeTitle: "Vol 1",
  author: "Author",
  cover: { sourceUrl: "cover", data: pngBytes, mimeType: "image/png" },
  chapters: [
    { id: "101", title: "Ch1", html: "<h2>Ch1</h2><p>A&nbsp;B</p><img src=\"http://host/v1/linovelib/illustration/abc\"><img src=\"http://host/v1/linovelib/illustration/missing\">" },
    { id: "102", title: "Ch2", html: "<p>Second</p><img src=\"http://host/v1/linovelib/illustration/abc\">" },
  ],
  illustrations: [sharedImg, sharedImg],
});
assert.ok(volBuf instanceof Uint8Array);
// 验证 ZIP 首条目为无压缩 mimetype（Local File Header: compression method at bytes 8..9 == 0, filename == "mimetype"）
assert.equal(volBuf[8]! | (volBuf[9]! << 8), 0);
const nameLen = volBuf[26]! | (volBuf[27]! << 8);
const extraLen = volBuf[28]! | (volBuf[29]! << 8);
assert.equal(new TextDecoder().decode(volBuf.subarray(30, 30 + nameLen)), "mimetype");
assert.equal(new TextDecoder().decode(volBuf.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + 20)), "application/epub+zip");
const files = unzipSync(volBuf);
assert.equal(Object.keys(files).filter((k) => k.startsWith("OEBPS/images/img-")).length, 1);
assert.ok(!strFromU8(files["OEBPS/content.opf"]!).includes("charset=binary"));
assert.ok(strFromU8(files["OEBPS/text/ch-0001.xhtml"]!).includes("[插图未包含]"));
const novelBuf = buildNovelEpub({
  identifier: "urn:acanthis:linovelib:1",
  title: "Test Novel",
  author: "Author",
  volumes: [{ id: "10", title: "Vol 1", cover: { sourceUrl: "vol-cover", data: pngBytes, mimeType: "image/png" }, chapters: [{ id: "101", title: "Ch1", html: "<p>Hi</p>" }] }],
  illustrations: [],
});
const novelFiles = unzipSync(novelBuf);
assert.ok(novelFiles["OEBPS/text/vol-001.xhtml"] && strFromU8(novelFiles["OEBPS/nav.xhtml"]!).includes("vol-001.xhtml"));
console.log("EPUB archive E2E checks passed");
'
```
Expected: 全部类型检查、build、Biome 检查与 ZIP 二进制实测通过。

- [ ] **Step 4: Commit**

```bash
git add packages/epub/src/archive.ts packages/epub/src/index.ts packages/epub/README.md packages/epub/README.zh-CN.md
git commit -m "feat(epub): 完成 buildVolumeEpub 与 buildNovelEpub 内存归档引擎" -m "基于 fflate 实现首条目无压缩 mimetype、sourceUrl 去重图片注册与 MIME 参数剥离的纯内存 EPUB 3.0 归档，并补充双语 README。"
```

---

### Task 5: `apps/cli` 包脚手架、配置解析与 HTTP 客户端（含媒体 URL 重定基）

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/tsdown.config.ts`
- Create: `apps/cli/src/types.ts`
- Create: `apps/cli/src/config.ts`
- Create: `apps/cli/src/client.ts`
- Modify: `pnpm-lock.yaml`（通过 `pnpm install` 更新）

**Interfaces:**
- Consumes:
  - `@acanthis-dec/core`: `Novel`, `NovelInfo`, `NovelSearchResult`, `NovelSourceDescriptor`, `Volume`, `Chapter`
  - 第一步服务端 HTTP 路由：`GET /v1/sources`, `GET /v1/:source/novels`, `GET /v1/:source/search`, `GET /v1/:source/novel/:novelId`, `GET /v1/:source/chapter/:chapterId?novelId=`, `GET /v1/:source/cover/novel/:novelId`, `GET /v1/:source/cover/volume/:volumeId`, `GET /v1/:source/illustration/:hash`
- Produces:
  - `apps/cli/src/types.ts`:
    - `CliStoredConfig`: `{ serverUrl?: string; token?: string; defaultSource?: string; outputDir?: string }`
    - `ResolvedCliConfig`: `{ serverUrl: string; token?: string | undefined; defaultSource: string; outputDir: string }`
    - `CliConfigKey`: `"serverUrl" | "token" | "defaultSource" | "outputDir"`
    - `ExportMode`: `"split" | "merged"`
    - `ExportOptions`: `{ novelIdOrUrl: string; serverUrl: string; source: string; token?: string | undefined; outputDir: string; mode: ExportMode; volumes?: string | undefined; illustrations: boolean; strict: boolean; overwrite: boolean; json: boolean }`
    - `ExportFileResult`: `{ path: string; title: string; volumeId?: string | undefined; chapterCount: number; skipped: boolean }`
    - `ExportSummary`: `{ novelId: string; novelTitle: string; source: string; mode: ExportMode; files: ExportFileResult[]; warnings: string[] }`
  - `apps/cli/src/config.ts`:
    - `export function getConfigFilePath(): string`
    - `export async function readStoredConfig(): Promise<CliStoredConfig>`
    - `export async function loadCliConfig(overrides?: Partial<ResolvedCliConfig>): Promise<ResolvedCliConfig>`
    - `export async function saveCliConfigValue(key: CliConfigKey, value: string): Promise<ResolvedCliConfig>`
    - `export async function resetCliConfig(): Promise<void>`
  - `apps/cli/src/client.ts`:
    - `export class ApiClientError extends Error`（含 `status?: number`, `code?: number`, `exitCode: number`）
    - `export function normalizeServerUrl(url: string): string`
    - `export function rebaseMediaUrl(rawUrl: string, serverUrl: string): string`
    - `export class AcanthisApiClient`（`constructor(serverUrl: string, token?: string)`；方法：`getSources()`, `listNovels(source, page, pageSize)`, `searchNovels(source, keyword)`, `getNovel(source, novelId)`, `getChapterContent(source, chapterId, novelId)`, `fetchBinary(rawUrl)`）

- [ ] **Step 1: 创建 `apps/cli/package.json`、`tsconfig.json` 与 `tsdown.config.ts`**

- `apps/cli/package.json`：
  - `"name": "@acanthis-dec/cli"`、`"version": "0.1.0"`、`"type": "module"`、`"packageManager": "pnpm@12.21.0"`（**不设置 `"private": true`**）；
  - `"bin": { "acanthis": "./dist/index.mjs" }`；
  - `"files": ["dist", "package.json", "README.md", "README.zh-CN.md"]`；
  - `"scripts": { "build": "tsdown", "build:bin": "bun build ./src/index.ts --compile --minify --outfile ./dist/acanthis", "check-types": "tsc --noEmit" }`；
  - `dependencies`: `"@acanthis-dec/core": "workspace:*"`, `"@acanthis-dec/epub": "workspace:*"`, `"@clack/prompts": "^1.0.1"`（或 `pnpm install` 解析最新兼容纯 ESM 版）, `"citty": "^0.2.1"`, `"picocolors": "^1.1.1"`, `"zod": "^4.6.7"`（严禁引入 `@acanthis-dec/linovelib` 或任何原生扩展）；
  - `devDependencies`: `"@acanthis-dec/config-tsdown": "workspace:*"`, `"@acanthis-dec/config-typescript": "workspace:*"`, `"@types/node": "catalog:"`, `"tsdown": "catalog:"`, `"tsx": "catalog:"`, `"typescript": "catalog:"`。
- `apps/cli/tsconfig.json`：`{ "extends": "@acanthis-dec/config-typescript/apps.json" }`。
- `apps/cli/tsdown.config.ts`：展开 `baseConfig`，设置 `dts: false`、`banner: { js: "#!/usr/bin/env node" }`、`outExtensions: () => ({ js: ".mjs" })`（确保稳定输出 `dist/index.mjs` 匹配 `"bin"`）。

- [ ] **Step 2: 实现 `apps/cli/src/types.ts` 与 `apps/cli/src/config.ts`**

- `config.ts` 严格实现 4 级优先级：CLI 显式参数 > 环境变量（`ACANTHIS_SERVER_URL`、`ACANTHIS_API_TOKEN`、`ACANTHIS_SOURCE`、`ACANTHIS_OUTPUT_DIR`，空字符串跳过） > 用户配置文件（`process.platform === "win32"` 时 `path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "acanthis", "config.json")`，其余平台 `path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "acanthis", "config.json")`） > 默认值（`serverUrl: "http://localhost:5301"`、`defaultSource: "linovelib"`、`outputDir: "."`、`token: undefined`）。
- 使用 Zod 校验配置文件 JSON 结构；`saveCliConfigValue` 使用写临时文件 + `rename` 原子写入（父目录不存在时 `mkdir(..., { recursive: true })`）。

- [ ] **Step 3: 实现 `apps/cli/src/client.ts`（含参数化 `:source`、鉴权与媒体 URL 重定基）**

- `rebaseMediaUrl(rawUrl, serverUrl)` 核心规则（对应 Review Focus #4）：
  - 去除 `serverUrl` 末尾斜杠；
  - 若 `rawUrl` 以 `/v1/` 开头，直接返回 `${base}${rawUrl}`；
  - 否则尝试 `new URL(rawUrl)`：若其 `pathname` 中包含 `/v1/`（应对服务端未配 `HOST` 返回 `http://localhost:5301/v1/...` 或挂载于反代前缀下），提取从 `/v1/` 起的 `pathname + search` 拼接到 `${base}` 后（若 `base` 自带路径前缀则去重衔接）；其余非 `/v1/` URL 原样返回。
- `AcanthisApiClient`：
  - JSON 请求均带 `Accept: application/json`；配置 `token` 时附加 `Authorization: Bearer ${token}`；
  - 所有书源路径使用 `/v1/${encodeURIComponent(source)}/...`（`sources` 为 `/v1/sources`；`chapter` 始终携带 `?novelId=${encodeURIComponent(novelId)}`）；
  - 错误解析兼容 `{ code, message }`（`401`/`40100`、`404`/`10000..10003`、`500`/`20000`）、遗留 `{ error }` 与纯文本，非 2xx 抛出 `ApiClientError`（携带 `status` 与 `code`）；
  - `fetchBinary(rawUrl)` 先通过 `rebaseMediaUrl(rawUrl, serverUrl)` 得到真实请求 URL，使用 `fetch` 拉取 `Uint8Array` 与 `Content-Type`（同样在存在 `token` 时可选不带或仅同源带；注意图片接口免鉴权），返回 `{ data: Uint8Array; mimeType: string }`。

- [ ] **Step 4: 安装依赖并验证配置优先级与媒体重定基实测（覆盖 Review Focus #4）**

创建临时占位 `apps/cli/src/index.ts`（仅 `export {};` 以便 `tsdown` 在 Task 7 前通过），随后执行：
Run:
```bash
pnpm install
pnpm --filter=@acanthis-dec/cli run check-types
pnpm --filter=@acanthis-dec/cli exec tsx -e '
import assert from "node:assert/strict";
import { loadCliConfig } from "./src/config.ts";
import { rebaseMediaUrl } from "./src/client.ts";
process.env.ACANTHIS_SERVER_URL = "https://env.example.com/";
process.env.ACANTHIS_SOURCE = "syosetu";
const cfg = await loadCliConfig({ serverUrl: "https://cli.example.com/proxy/" });
assert.equal(cfg.serverUrl, "https://cli.example.com/proxy");
assert.equal(cfg.defaultSource, "syosetu");
assert.equal(rebaseMediaUrl("http://localhost:5301/v1/linovelib/illustration/abcdef0123456789abcdef0123456789", "https://cli.example.com/proxy"), "https://cli.example.com/proxy/v1/linovelib/illustration/abcdef0123456789abcdef0123456789");
assert.equal(rebaseMediaUrl("/v1/syosetu/cover/novel/42", "https://cli.example.com"), "https://cli.example.com/v1/syosetu/cover/novel/42");
console.log("CLI config & rebase checks passed");
'
```
Expected: 类型检查通过且断言输出 `CLI config & rebase checks passed`。

- [ ] **Step 5: Commit**

```bash
git add apps/cli/package.json apps/cli/tsconfig.json apps/cli/tsdown.config.ts apps/cli/src/types.ts apps/cli/src/config.ts apps/cli/src/client.ts apps/cli/src/index.ts pnpm-lock.yaml
git commit -m "feat(cli): 初始化 @acanthis-dec/cli 脚手架、配置管理与重定基 HTTP 客户端" -m "创建无 private 限制与纯 JS 依赖的 CLI 包配置，实现 4 级配置优先级、原子配置文件读写以及参数化 :source 与媒体 URL 重定基 HTTP 客户端。"
```

---

### Task 6: `apps/cli` 下载调度与 EPUB 导出引擎（串行章节、并发图片、文件名清洗与容错）

**Files:**
- Create: `apps/cli/src/utils.ts`
- Create: `apps/cli/src/exporter.ts`

**Interfaces:**
- Consumes: `AcanthisApiClient`, `ApiClientError` (`apps/cli/src/client.ts`), `buildVolumeEpub`, `buildNovelEpub`, `EpubImageAsset`, `EpubChapterData`, `EpubVolumeData` (`@acanthis-dec/epub`), `Novel`, `Volume` (`@acanthis-dec/core`)
- Produces:
  - `apps/cli/src/utils.ts`:
    - `export function parseNovelIdOrUrl(input: string): string`
    - `export function isUnresolvedChapterId(chapterId: string): boolean`
    - `export function sanitizeFilename(name: string): string`
    - `export function parseVolumeSelection(spec: string | undefined, volumes: Volume[]): Volume[]`
    - `export function extractImgSrcUrls(html: string): string[]`
    - `export function withConcurrencyLimit<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>`
  - `apps/cli/src/exporter.ts`:
    - `export interface ExportProgressEvent { phase: "novel" | "chapters" | "images" | "pack" | "write"; current: number; total: number; message: string }`
    - `export interface ExportRunnerCallbacks { onProgress?: (event: ExportProgressEvent) => void; onWarning?: (message: string) => void }`
    - `export async function runExport(client: AcanthisApiClient, options: ExportOptions, callbacks?: ExportRunnerCallbacks): Promise<ExportSummary>`

- [ ] **Step 1: 实现 `apps/cli/src/utils.ts`**

- `parseNovelIdOrUrl(input)`：去除首尾空白；若为纯数字/合法 ID 直接返回；否则解析 URL 匹配 `/novel/(\d+)\.html` 或末段数字路径，无法识别时抛出明确错误（不依赖 `@acanthis-dec/linovelib`）。
- `isUnresolvedChapterId(id)`：严格对齐第一步，返回 `id.startsWith("TOBEDETERMINED")`。
- `sanitizeFilename(name)`：移除 Windows/跨平台非法字符 `[<>:"/\\|?*\x00-\x1f]`、折叠连续空白为单空格，并截断首尾空格与末尾 `.`（防止 Windows NTFS 拒绝），结果为空时回退 `"untitled"`。
- `parseVolumeSelection(spec, volumes)`：支持逗号分隔的 1 基序号或闭区间（如 `1,3-5`）以及直接匹配 `volume.id`；越界或非法表达式抛出清晰校验错误；按原书卷顺序去重返回目标 `Volume[]`。
- `extractImgSrcUrls(html)`：使用 `htmlparser2`（或与 `packages/linovelib` 等价的 `<img ... src=...>` 解析）提取章节 HTML 内全部原始 `src` 字符串（保留字面量，不提前改写）。

- [ ] **Step 2: 实现 `apps/cli/src/exporter.ts`**

关键调度与容错逻辑：
1. **获取作品与筛选分卷**：调用 `client.getNovel(options.source, novelId)` 与 `parseVolumeSelection(options.volumes, novel.volumes)`。
2. **章节串行拉取（`concurrency = 1`）**：
   - 逐章顺序拉取；遇到 `isUnresolvedChapterId(chapter.id)` 时，若 `options.strict` 为 `true` 立即抛错中止，否则触发 `onWarning` 并跳过该章；
   - 单章网络/5xx/404 请求实现指数退避重试最多 3 次（`500ms` -> `1000ms` -> `2000ms`）；3 次均失败时，若 `strict` 立即中止，否则告警并跳过。
3. **媒体去重与并发拉取（`concurrency = 4`）**：
   - 收集作品封面、所选分卷封面，以及（当 `options.illustrations !== false` 时）所有已拉取章节 `extractImgSrcUrls(html)` 的去重 URL；
   - 为每个媒体保留原始 `src` 作为 `EpubImageAsset.sourceUrl` 键，调用 `client.fetchBinary(rawUrl)`（内部重定基至 `serverUrl`）；
   - **分卷封面 404 容错（Review Focus #1）**：若分卷封面请求捕获 `ApiClientError` 且 `status === 404`（含 `code === 10001`），记为无封面（`undefined`），**不记作失败，即便 `--strict` 也不中止**；`split` 模式自动回退作品封面，`merged` 模式置 `volume.cover = undefined`。
   - 作品封面或插图重试 3 次后仍失败：若 `strict` 且为插图则抛错中止；非严格模式下触发 `onWarning` 并省略该插图资产（交由 `packages/epub` 替换为 `[插图未包含]` 占位）。
4. **文件名构造、覆写检查与写盘**：
   - `split`：`[作者] 书名 - 分卷名.epub`（每卷调用 `buildVolumeEpub`）；
   - `merged`：全选全部分卷为 `[作者] 书名.epub`，部分选中为 `[作者] 书名 (选集).epub`（调用 `buildNovelEpub`）；
   - 均经 `sanitizeFilename` 清洗；写入前若目标文件已存在且 `!options.overwrite`，在 `split` 模式记录 `skipped: true` 告警跳过（或单文件目标全部跳过时返回明确状态）；确保 `outputDir` 自动 `mkdir(..., { recursive: true })`。

- [ ] **Step 3: 类型检查与本地模拟服务端边界实测（覆盖 Review Focus #1、#4、#5）**

Run:
```bash
pnpm --filter=@acanthis-dec/cli run check-types
pnpm --filter=@acanthis-dec/cli exec tsx -e '
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AcanthisApiClient } from "./src/client.ts";
import { runExport } from "./src/exporter.ts";
import { parseNovelIdOrUrl, parseVolumeSelection, sanitizeFilename } from "./src/utils.ts";
assert.equal(parseNovelIdOrUrl("https://www.linovelib.com/novel/3590.html"), "3590");
assert.equal(sanitizeFilename("Test:<>Book?. "), "TestBook");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const srv = http.createServer((req, res) => {
  if (req.url?.startsWith("/v1/custom/novel/1")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: 0, message: "Success", data: { id: "1", platform: "custom", title: "Book:1?", author: "A/B", summary: "", status: "ongoing", genres: [], coverUrl: "http://localhost:5301/v1/custom/cover/novel/1", volumes: [{ id: "10", title: "V1.", coverUrl: "http://localhost:5301/v1/custom/cover/volume/10", chapters: [{ id: "100", title: "C1", novelId: "1" }, { id: "TOBEDETERMINED_0_1", title: "Hidden", novelId: "1" }] }] } }));
  } else if (req.url?.startsWith("/v1/custom/chapter/100")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: 0, message: "Success", data: { content: "<p>Hi</p><img src=\"http://localhost:5301/v1/custom/illustration/0123456789abcdef0123456789abcdef\">" } }));
  } else if (req.url?.includes("/cover/volume/10")) {
    res.statusCode = 404; res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: 10001, message: "Cover not found" }));
  } else if (req.url?.includes("/cover/novel/1") || req.url?.includes("/illustration/")) {
    res.setHeader("Content-Type", "image/png"); res.end(png);
  } else { res.statusCode = 404; res.end(); }
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as { port: number }).port;
const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "acanthis-cli-t6-"));
const client = new AcanthisApiClient(`http://127.0.0.1:${port}`);
// 1) 非 strict：分卷无封面 404 回退 + 跳过 TOBEDETERMINED + Windows 非法文件名清洗 + 媒体重定基
const summary = await runExport(client, { novelIdOrUrl: "1", serverUrl: `http://127.0.0.1:${port}`, source: "custom", outputDir: outDir, mode: "split", illustrations: true, strict: false, overwrite: true, json: true });
assert.equal(summary.files.length, 1);
assert.ok(!summary.files[0]!.path.endsWith("..epub"));
// 2) strict 下分卷无封面 404 仍不报错，但遇到 TOBEDETERMINED 必报错
await assert.rejects(() => runExport(client, { novelIdOrUrl: "1", serverUrl: `http://127.0.0.1:${port}`, source: "custom", outputDir: outDir, mode: "merged", illustrations: true, strict: true, overwrite: true, json: true }), /TOBEDETERMINED|未决/);
srv.close();
await fs.rm(outDir, { recursive: true, force: true });
console.log("Exporter E2E checks passed");
'
```
Expected: 全部断言通过，输出 `Exporter E2E checks passed`。

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/utils.ts apps/cli/src/exporter.ts
git commit -m "feat(cli): 实现串行拉章、并发去重拉图与容错 EPUB 导出引擎" -m "实现 URL/分卷范围解析与 Windows 安全文件名清洗，完成串行退避拉章、并发 4 媒体去重下载、分卷封面 404 回退及 TOBEDETERMINED 严格模式校验。"
```

---

### Task 7: `apps/cli` 命令体系、交互式向导与可执行入口

**Files:**
- Create: `apps/cli/src/commands/shared.ts`
- Create: `apps/cli/src/commands/export.ts`
- Create: `apps/cli/src/commands/search.ts`
- Create: `apps/cli/src/commands/list.ts`
- Create: `apps/cli/src/commands/sources.ts`
- Create: `apps/cli/src/commands/info.ts`
- Create: `apps/cli/src/commands/config.ts`
- Create: `apps/cli/src/interactive.ts`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/README.md`
- Create: `apps/cli/README.zh-CN.md`

**Interfaces:**
- Consumes: `loadCliConfig`, `saveCliConfigValue`, `resetCliConfig`, `getConfigFilePath`, `AcanthisApiClient`, `runExport`, `parseNovelIdOrUrl`, `isUnresolvedChapterId`
- Produces: 可执行入口 `apps/cli/dist/index.mjs`（`acanthis` 主命令、`export`、`search`、`list`、`sources`、`info`、`config`）

- [ ] **Step 1: 实现 `apps/cli/src/commands/shared.ts` 与各子命令**

- `shared.ts`：定义共用 `citty` 参数（`server`/`s`、`source`、`token`/`t`、`json`）、输出助手（`--json` 时进度/警告全部写 `process.stderr.write(...)`，`stdout` 仅调用一次 `console.log(JSON.stringify(...))`）与统一退出码映射（`0` 成功、`1` 运行/鉴权/严格模式/非 TTY 错误、`2` 参数或配置错误）。
- `export.ts`：支持 `<novelIdOrUrl>` 位置参数及 `-s/--server`、`--source`、`-t/--token`、`-o/--output`、`-m/--mode`（`split|merged`，默认 `split`）、`--merged`（等价 `--mode merged`）、`-v/--volumes`、`--no-illustrations`（注意 `citty` 布尔否定参数解析兼容 `illustrations: { type: "boolean", default: true }`，确保 `--no-illustrations` 置为 `false`）、`--strict`、`--overwrite`、`--json`。
- `search.ts`、`list.ts`（`--page`、`--page-size`）、`sources.ts`、`info.ts`（展示作品详情、1 基卷序号、章节数与未决章节计数提醒）：均支持 `-s/--server`、`--source`（`sources` 除外）、`-t/--token`、`--json`。
- `config.ts`：子动作 `get <key>`、`set <key> <value>`、`list`、`reset`、`path`（键白名单限制为 `serverUrl`、`token`、`defaultSource`、`outputDir`；`list` 与 `get` 展示 `token` 时可选择明文或受控展示，遵循可读可用原则）。

- [ ] **Step 2: 实现 `apps/cli/src/interactive.ts` 与 `apps/cli/src/index.ts`**

- `interactive.ts`：使用 `@clack/prompts` + `picocolors` 实现完整交互向导：
  1. 连通性探测（调用 `getSources()`），失败时提示输入新 `serverUrl` 并询问是否保存至用户配置；若多于 1 个书源则让用户选择，否则默认唯一书源；
  2. 选择操作入口：浏览服务端已缓存书库（分页调用 `listNovels`）/ 关键词搜索（`searchNovels`）/ 直接输入作品 ID 或 URL；
  3. 展示作品摘要并提示未决章节数（若有），使用 `multiselect` 多选目标分卷；
  4. 选择导出模式（`split` 按卷导出 / `merged` 合并导出）与确认输出目录；
  5. 调用 `runExport` 配合 `spinner` 展示阶段进度，最后打印生成文件路径与跳过/警告摘要。
- `index.ts`：使用 `citty` `defineCommand` 配置 `meta: { name: "acanthis", version: pkg.version, description: ... }`（通过 `import pkg from "../package.json" with { type: "json" }` 内联版本号，确保 `tsdown` 与 `bun build --compile` 单文件下 `--version` 均正常输出）并挂载 `export`、`search`、`list`、`sources`、`info`、`config`；当无子命令进入主命令 `run` 时，仅当未传入子命令且 `process.stdin.isTTY && process.stdout.isTTY` 才启动 `runInteractiveWizard()`；若为非 TTY 环境则打印帮助信息并设置 `process.exitCode = 1`。同时在 `README.md` / `README.zh-CN.md` 写明全部子命令、环境变量与安装/退出码说明。

- [ ] **Step 3: 类型检查、构建、Lint 与 CLI 全命令端到端实测（覆盖 Review Focus #1、#4、#5）**

Run:
```bash
pnpm --filter=@acanthis-dec/cli run check-types
pnpm --filter=@acanthis-dec/cli run build
pnpm run format-and-lint
node apps/cli/dist/index.mjs --version
```
确认 `apps/cli/dist/index.mjs` 首行为 `#!/usr/bin/env node` 且 `--version` 输出 `0.1.0`。

端到端实测（通过 Node 启动临时测试 HTTP 服务或连接已运行的第一步 `api-server`，验证非 TTY 退出码、`--json` stdout 纯净性、`sources`/`list`/`search`/`info`/`config`/`export`；注意若对接 Task 6 本地 HTTP Mock，`--source` 需与 Mock 路由源名如 `custom` 保持一致，对接真实 `api-server` 则使用 `linovelib`）：
```bash
# 1) 非 TTY 无子命令必须打印帮助且退出码为 1（不可阻塞）
pnpm --filter=@acanthis-dec/cli exec tsx -e '
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const r = spawnSync("node", ["./dist/index.mjs"], { input: "", encoding: "utf8" });
assert.equal(r.status, 1);
assert.ok((r.stdout + r.stderr).includes("acanthis"));
console.log("Non-TTY exit code 1 check passed");
'
# 2) config 与完整 CLI 子命令实测（<port> 替换为第一步 api-server 或临时 HTTP Mock 端口）
# Bash / zsh：
ACANTHIS_OUTPUT_DIR=./tmp-cli-out node apps/cli/dist/index.mjs config path
# Windows PowerShell 等价写法：
# $env:ACANTHIS_OUTPUT_DIR="./tmp-cli-out"; node apps/cli/dist/index.mjs config path; Remove-Item Env:ACANTHIS_OUTPUT_DIR
node apps/cli/dist/index.mjs sources --server http://127.0.0.1:<port> --json | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); if(!Array.isArray(d)) process.exit(1)"
node apps/cli/dist/index.mjs export 1 --server http://127.0.0.1:<port> --source linovelib --mode merged -v 1 -o ./tmp-cli-out --no-illustrations --overwrite --json | node -e "const r = JSON.parse(require('fs').readFileSync(0,'utf8')); if(!r.files?.length) process.exit(1)"
```
Expected: 非 TTY 返回退出码 `1`；`--json` stdout 为合法 JSON 无任何 ANSI/进度条混入；本地生成的 `.epub` 文件非空且可用 `fflate.unzipSync` 正常解压校验。验证完毕清理临时目录 `./tmp-cli-out`。

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/ apps/cli/README.md apps/cli/README.zh-CN.md
git commit -m "feat(cli): 完成全套子命令、交互向导与可执行入口" -m "实现 export/search/list/sources/info/config 子命令与 --json 纯净 stdout 控制、@clack/prompts 交互向导及非 TTY 退出码 1 防阻塞入口，并补充双语 README。"
```

---

### Task 8: 双轨打包、GitHub Release 工作流、WinGet / Homebrew 清单生成器与 CI 集成

**Files:**
- Create: `apps/cli/scripts/generate-manifests.ts`
- Create: `.github/workflows/cli-release.yml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `apps/cli/package.json` (`version`), `SHA256SUMS.txt`
- Produces:
  - `apps/cli/scripts/generate-manifests.ts`（CLI 脚本：读取 `--version`、`--repo`、`--checksums`、`--out-dir`，生成 `Formula/acanthis.rb` 与 `manifests/c/ConstasJ/Acanthis/<version>/*.yaml`）
  - `.github/workflows/cli-release.yml`
  - `.github/workflows/ci.yml`（新增 `cli` 变更输出与过滤器，更新 `ci` 过滤器）

- [ ] **Step 1: 实现 `apps/cli/scripts/generate-manifests.ts`**

输入参数（通过 `node:util` `parseArgs` 解析）：`--version`（去掉前导 `v` 后的 semver，如 `0.1.0`）、`--repo`（默认 `ConstasJ/Acanthis`）、`--checksums`（`SHA256SUMS.txt` 路径）、`--out-dir`（输出目录）。
读取并校验 5 个归档文件名对应的 64 位十六进制 SHA-256（缺一即报错退出）：
- `acanthis-v${version}-darwin-arm64.tar.gz`
- `acanthis-v${version}-darwin-x64.tar.gz`
- `acanthis-v${version}-linux-arm64.tar.gz`
- `acanthis-v${version}-linux-x64.tar.gz`
- `acanthis-v${version}-windows-x64.zip`

确定性产出：
1. `Formula/acanthis.rb`：标准 Ruby Homebrew Formula（`class Acanthis < Formula`），按 `on_macos` / `on_linux` 与 `Hardware::CPU.arm?` / `Hardware::CPU.intel?` 填充对应 `.tar.gz` Release URL 与 `sha256`，包含 `bin.install "acanthis"` 与 `test { assert_match version.to_s, shell_output("#{bin}/acanthis --version") }`。
2. `manifests/c/ConstasJ/Acanthis/${version}/` 下的 4 份 WinGet Schema 1.6/1.9 清单：
   - `ConstasJ.Acanthis.yaml`（`ManifestType: version`）
   - `ConstasJ.Acanthis.locale.en-US.yaml`（`ManifestType: defaultLocale`）
   - `ConstasJ.Acanthis.locale.zh-CN.yaml`（`ManifestType: locale`）
   - `ConstasJ.Acanthis.installer.yaml`（`ManifestType: installer`，`InstallerType: zip`、`NestedInstallerType: portable`、`NestedInstallerFiles: [{ RelativeFilePath: acanthis.exe, PortableCommandAlias: acanthis }]`，填入 `acanthis-v${version}-windows-x64.zip` 下载链接与 `InstallerSha256`）。

- [ ] **Step 2: 编写 `.github/workflows/cli-release.yml` 与更新 `.github/workflows/ci.yml`**

- `.github/workflows/cli-release.yml`（参照 `.github/workflows/docker-release.yml`）：
  - 触发器：`on.push.tags: ["@acanthis-dec/cli@*"]` 与 `workflow_dispatch`（可选输入 `version`）；
  - `build-binaries` Job（`ubuntu-latest` + `actions/checkout@v6` + `oven-sh/setup-bun`）：读取 `apps/cli/package.json` 的 `version`，依次执行 `bun build ./apps/cli/src/index.ts --compile --minify --target=<target> --outfile ...` 生成 5 个平台归档并计算 `SHA256SUMS.txt`；调用 `bun apps/cli/scripts/generate-manifests.ts` 生成清单产物并上传为 Workflow Artifact；
  - `release` Job（`needs: build-binaries`，`permissions: { contents: write }`）：使用 `softprops/action-gh-release@v2` 上传 5 个归档、`SHA256SUMS.txt`、`Formula/acanthis.rb` 及 WinGet 清单归档；
  - `update-homebrew` Job（`if: vars.HOMEBREW_TAP_REPO != '' && secrets.PACKAGE_MANAGER_TOKEN != ''`）：检出 `${{ vars.HOMEBREW_TAP_REPO }}`，写入 `Formula/acanthis.rb` 并提交推送；
  - `submit-winget` Job（`if: vars.ENABLE_WINGET_RELEASE == 'true' && secrets.WINGET_TOKEN != ''`）：调用 `vedantmgoyal9/winget-releaser` 提交 PR 到 `microsoft/winget-pkgs`。
- `.github/workflows/ci.yml`：
  - `changes` Job 的 `outputs` 新增 `cli: ${{ steps.changes.outputs.cli }}`；
  - `filters` 中新增 `cli:` 匹配 `'apps/cli/src/**/*.ts'`、`'apps/cli/scripts/**/*.ts'`、`'apps/cli/package.json'`、`'apps/cli/tsconfig.json'`、`'apps/cli/tsdown.config.ts'`；
  - `ci:` 过滤器补充 `'.github/workflows/cli-release.yml'`。

- [ ] **Step 3: 全仓校验、清单脚本实测与可选 Bun 本地编译验证**

Run:
```bash
pnpm run format-and-lint
pnpm run check-types
pnpm run build
```
清单生成器实测（用模拟 `SHA256SUMS.txt` 验证 5 个产物全部写入且格式正确）：
```bash
pnpm --filter=@acanthis-dec/cli exec tsx -e '
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acanthis-manifests-"));
const sums = path.join(tmp, "SHA256SUMS.txt");
const hash = "a".repeat(64);
fs.writeFileSync(sums, [
  `${hash}  acanthis-v0.1.0-darwin-arm64.tar.gz`,
  `${hash}  acanthis-v0.1.0-darwin-x64.tar.gz`,
  `${hash}  acanthis-v0.1.0-linux-arm64.tar.gz`,
  `${hash}  acanthis-v0.1.0-linux-x64.tar.gz`,
  `${hash}  acanthis-v0.1.0-windows-x64.zip`,
].join("\n"));
execFileSync("pnpm", ["--filter=@acanthis-dec/cli", "exec", "tsx", "./scripts/generate-manifests.ts", "--version", "0.1.0", "--repo", "ConstasJ/Acanthis", "--checksums", sums, "--out-dir", tmp], { stdio: "inherit", shell: process.platform === "win32" });
if (!fs.existsSync(path.join(tmp, "Formula/acanthis.rb"))) throw new Error("Missing Formula");
if (!fs.existsSync(path.join(tmp, "manifests/c/ConstasJ/Acanthis/0.1.0/ConstasJ.Acanthis.installer.yaml"))) throw new Error("Missing WinGet installer manifest");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("Manifest generator checks passed");
'
```
若本机已安装 `bun`，追加执行单二进制实测：
```bash
pnpm --filter=@acanthis-dec/cli run build:bin
./apps/cli/dist/acanthis --help
```
Expected: 全仓 lint、check-types、build 全部通过；`Formula/acanthis.rb` 与 4 份 WinGet YAML 准确生成（含正确 SHA-256 与嵌套 portable 字段）；若本机有 `bun`，可执行二进制正常打印帮助。

- [ ] **Step 4: Commit**

```bash
git add apps/cli/scripts/generate-manifests.ts .github/workflows/cli-release.yml .github/workflows/ci.yml
git commit -m "ci(cli): 添加多平台单二进制发布流水线与 WinGet/Homebrew 清单生成器" -m "新增 generate-manifests.ts 校验 5 平台 SHA-256 并生成 Homebrew Formula 与 WinGet 清单，配置 cli-release.yml 双轨发布并在 ci.yml 接入 cli 变更过滤。"
```
