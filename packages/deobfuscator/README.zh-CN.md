# @acanthis-dec/deobfuscator

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 的小型反混淆辅助包。它检测常见 JavaScript 混淆形态，并通过窄 API 将恢复过程交给 `webcrack` 封装。

## 安装

工作区内使用：

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/deobfuscator run check-types
pnpm --filter=@acanthis-dec/deobfuscator run build
```

从 workspace 源码或发布后的 ESM 包导入：

```ts
import { deobfuscate, detectObfuscation } from "@acanthis-dec/deobfuscator";
```

## 用法

```ts
import { deobfuscate, detectObfuscation } from "@acanthis-dec/deobfuscator";

const source = "const value = 1;";

if (detectObfuscation(source)) {
	const readable = await deobfuscate(source);
	console.log(readable);
}
```

## API

- `detectObfuscation(code)` 判断 JavaScript 字符串是否呈现混淆特征。
- `deobfuscate(code)` 使用包内配置的 `webcrack` 封装返回恢复后的 JavaScript 字符串。

该包刻意保持很小的公开面，让来源适配器依赖能力本身，而不直接依赖 `webcrack`。
