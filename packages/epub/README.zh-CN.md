# @acanthis-dec/epub

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 的平台无关、零 Node 耦合纯内存 EPUB 3.0 组装引擎。它将轻小说元数据、清洗后的章节 HTML、封面及去重后的插图打包为标准 EPUB 3.0 归档（同时兼容 EPUB 2 NCX 目录与封面元数据），输出纯 `Uint8Array` 二进制数据，可直接运行于 Node.js、Bun、浏览器与 Web Worker 环境。

## 运行环境与兼容性保证

- **零 Node.js API 依赖**：包内不使用任何 `node:*` 模块或全局 `Buffer`。
- **编译期与打包期门禁**：`tsdown` 配置 `platform: "neutral"`，且 TypeScript 显式覆盖 `"types": []`（不引入 `@types/node`），确保浏览器端 Web Worker 无需任何 Node polyfill 即可直接打包运行。
- **EPUB 3.0 归档规范**：ZIP 首条目固定为无压缩 `mimetype`（`application/epub+zip`，`{ level: 0 }`），自动将 HTML 命名实体解码为 UTF-8、归一化章节首标题、清理危险标签与事件属性、按 `sourceUrl` 对插图去重注册，并将缺失插图替换为 `<p class="image-placeholder">[插图未包含]</p>`。

## 安装

工作区内使用：

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/epub run check-types
pnpm --filter=@acanthis-dec/epub run build
```

从 workspace 源码或发布后的 ESM 包导入：

```ts
import {
	buildNovelEpub,
	buildVolumeEpub,
	type EpubChapterData,
	type EpubImageAsset,
	type EpubVolumeData,
	type NovelEpubInput,
	type VolumeEpubInput,
} from "@acanthis-dec/epub";
```

## 用法

### 单卷导出（`buildVolumeEpub`）

```ts
import { buildVolumeEpub } from "@acanthis-dec/epub";

const epubBytes = buildVolumeEpub({
	identifier: "urn:acanthis:linovelib:3590:vol:101",
	novelTitle: "示例作品",
	volumeTitle: "第一卷",
	author: "示例作者",
	language: "zh-CN",
	cover: {
		sourceUrl: "https://example.invalid/cover.jpg",
		data: coverUint8Array,
		mimeType: "image/jpeg",
	},
	chapters: [
		{
			id: "1001",
			title: "第一章",
			html: "<p>你好&nbsp;世界</p>",
		},
	],
	illustrations: [],
});
```

### 整书多卷合集导出（`buildNovelEpub`）

```ts
import { buildNovelEpub } from "@acanthis-dec/epub";

const epubBytes = buildNovelEpub({
	identifier: "urn:acanthis:linovelib:3590",
	title: "示例作品",
	author: "示例作者",
	volumes: [
		{
			id: "101",
			title: "第一卷",
			chapters: [
				{
					id: "1001",
					title: "第一章",
					html: '<p>正文</p><img src="https://example.invalid/img-1.png" />',
				},
			],
		},
	],
	illustrations: [
		{
			sourceUrl: "https://example.invalid/img-1.png",
			data: imageUint8Array,
			mimeType: "image/png",
		},
	],
});
```

## API

### 函数

- `buildVolumeEpub(input: VolumeEpubInput): Uint8Array` — 生成包含一维章节目录（`nav.xhtml` + `toc.ncx`）的单卷 EPUB 3.0 归档。
- `buildNovelEpub(input: NovelEpubInput): Uint8Array` — 生成包含分卷扉页（`OEBPS/text/vol-XXX.xhtml`）、去重分卷封面与二级嵌套目录树的多卷合集 EPUB 3.0 归档。

### 公开类型

- `EpubImageAsset` — `{ sourceUrl: string; data: Uint8Array; mimeType: string }`，表示按 HTML `<img src>` / 来源 URL 索引的封面或插图二进制资产。
- `EpubChapterData` — `{ id: string; title: string; html: string }`，表示单章元数据与 HTML 正文。
- `EpubVolumeData` — `{ id: string; title: string; cover?: EpubImageAsset | undefined; chapters: EpubChapterData[] }`，表示整书合集中的单个分卷。
- `VolumeEpubInput` — `buildVolumeEpub` 的输入参数（`identifier`、`novelTitle`、`volumeTitle`、`author`，可选 `language`、`summary`、`genres`、`modifiedAt`、`cover`，以及 `chapters` 和 `illustrations`）。
- `NovelEpubInput` — `buildNovelEpub` 的输入参数（`identifier`、`title`、`author`，可选 `language`、`summary`、`genres`、`modifiedAt`、`cover`，以及 `volumes` 和 `illustrations`）。
