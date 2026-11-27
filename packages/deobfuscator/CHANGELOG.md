# @acanthis-dec/deobfuscator

## 1.0.3

### Patch Changes

- d4cebf0: 修复新版 `chapterlog.js` 使用注释标记与 IIFE 包裹导致章节解扰系数提取报 `SyntaxError` 的问题，并修复反混淆检测器中正则全局标志引发的重复调用状态残留。

## 1.0.2

### Patch Changes

- 51130dc: Fix published `types` metadata to point at generated declaration files.

## 1.0.1

### Patch Changes

- build(npm): 为 package.json 添加 types 字段，确保 npm 可以正确识别出这是一个有类型声明的包

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易
