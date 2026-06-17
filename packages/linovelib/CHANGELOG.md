# @acanthis-dec/linovelib

## 1.0.1

### Patch Changes

- build(npm): 为 package.json 添加 types 字段，确保 npm 可以正确识别出这是一个有类型声明的包
- fix(linovelib): 修复了一些导致功能降级或潜在风险的错误
  - NovelInfoQueue 和 NovelChapterQueue 的 delay 被前置到请求开始，避免请求响应时间被无故拖慢
  - searchNovels 在执行多页搜索的后续页面请求时，会自动执行一个 500ms-1000ms 的延迟，以模拟真实行为，避免被封禁
- Updated dependencies
  - @acanthis-dec/browser-fetch@1.0.1
  - @acanthis-dec/core@1.0.1
  - @acanthis-dec/deobfuscator@1.0.1
  - @acanthis-dec/storage@1.0.1

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易

### Patch Changes

- Updated dependencies
  - @acanthis-dec/browser-fetch@1.0.0
  - @acanthis-dec/core@1.0.0
  - @acanthis-dec/deobfuscator@1.0.0
  - @acanthis-dec/storage@1.0.0
