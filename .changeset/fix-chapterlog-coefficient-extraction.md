---
"@acanthis-dec/deobfuscator": patch
"@acanthis-dec/linovelib": patch
---

修复新版 `chapterlog.js` 使用注释标记与 IIFE 包裹导致章节解扰系数提取报 `SyntaxError` 的问题，并修复反混淆检测器中正则全局标志引发的重复调用状态残留。
