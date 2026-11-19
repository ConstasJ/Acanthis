---
"@acanthis-dec/browser-fetch": patch
---

修复 FileCookiesStore 从不持久化的问题：改为懒加载磁盘文件，并在写入/删除/清空后自动落盘，读取时恢复时间字段的 Date 类型
