# @acanthis-dec/core

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 的核心共享包。它包含平台无关的内容辅助方法、还原工具，以及供适配器、存储和 API server 复用的统一小说/章节类型定义。

## 安装

工作区内使用：

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/core run check-types
pnpm --filter=@acanthis-dec/core run build
```

从 workspace 源码或发布后的 ESM 包导入：

```ts
import { buildDescrambleMapping, joinChapterHtml, restoreByMapping } from "@acanthis-dec/core";
```

## 用法

```ts
import { buildDescrambleMapping, joinChapterHtml, restoreByMapping } from "@acanthis-dec/core";

const html = joinChapterHtml("Chapter 1", "<p>Hello</p>");

const mapping = buildDescrambleMapping(4, 1234, {
	multiplier: 9301,
	increment: 49297,
	modulus: 233280,
});

const restored = restoreByMapping(["b", "a", "d", "c"], mapping);
```

## API

- `joinChapterHtml(title, bodyHtml)` 为章节正文追加可选标题。
- `buildDescrambleMapping(length, seed, lcg, offset?)` 根据线性同余参数生成索引映射。
- `restoreByMapping(items, mapping)` 根据目标索引映射还原数组。
- `ContentNode` 描述段落、图片和原始 HTML 内容节点。
- `DescrambleCoefficients` 与 `LcgConfig` 描述还原参数。
- `Novel`、`NovelInfo`、`NovelSearchResult`、`NovelStatus`、`Volume`、`Chapter`、`ChapterContent` 描述统一阅读元数据与内容。
