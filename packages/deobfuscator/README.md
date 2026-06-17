# @acanthis-dec/deobfuscator

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Small deobfuscation helper package for Acanthis. It detects common JavaScript obfuscation patterns and delegates recovery to `webcrack` behind a narrow API.

## Installation

Workspace usage:

```powershell
pnpm install --frozen-lockfile
pnpm --filter=@acanthis-dec/deobfuscator run check-types
pnpm --filter=@acanthis-dec/deobfuscator run build
```

Import from workspace source or the published ESM package:

```ts
import { deobfuscate, detectObfuscation } from "@acanthis-dec/deobfuscator";
```

## Usage

```ts
import { deobfuscate, detectObfuscation } from "@acanthis-dec/deobfuscator";

const source = "const value = 1;";

if (detectObfuscation(source)) {
	const readable = await deobfuscate(source);
	console.log(readable);
}
```

## API

- `detectObfuscation(code)` returns whether a JavaScript string appears to be obfuscated.
- `deobfuscate(code)` returns a recovered JavaScript string using the package's configured `webcrack` wrapper.

This package intentionally keeps its public surface small so source adapters can depend on the capability without depending on `webcrack` directly.
