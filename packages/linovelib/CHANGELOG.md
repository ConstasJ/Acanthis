# @acanthis-dec/linovelib

## 1.1.0

### Minor Changes

- 31e0ddb: 适配新的搜索请求模式

### Patch Changes

- Updated dependencies [8949718]
- Updated dependencies [2c8596b]
  - @acanthis-dec/browser-fetch@1.1.0
  - @acanthis-dec/core@1.1.0
  - @acanthis-dec/storage@1.0.6

## 1.0.5

### Patch Changes

- 7c60833: 新增了 Chrome 150 的 porfile，同时重构了 profile 体系
- Updated dependencies [7c60833]
  - @acanthis-dec/browser-fetch@1.0.4
  - @acanthis-dec/storage@1.0.5

## 1.0.4

### Patch Changes

- 07ff2b5: 重构 getNovelVolumes，引入并行机制以充分利用队列能力
- 1e4b6f1: 将 getNovelCover 的 URL 获取改为直接根据规则拼接
- Updated dependencies [10ea62d]
  - @acanthis-dec/browser-fetch@1.0.3
  - @acanthis-dec/storage@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [27ddae6]
  - @acanthis-dec/storage@1.0.3

## 1.0.2

### Patch Changes

- 3901772: 就封面获取相关功能进行了一轮重构
  - 删去了无用的 LinovelibClient.getNovelCover 方法和 getCover 函数
  - 新增了 getNovelCoverUrl 和 getVolumeCoverUrl 函数，直接从小说页面获取小说封面 URL，从小说目录获取卷封面 URL
  - 为 LinovelibClient 新增了 getNovelCover 和 getVolumeCover 两个方法，基于上面两个函数封装成可以一次性获取 URL 和数据的方法
- 51130dc: Fix published `types` metadata to point at generated declaration files.
- Updated dependencies [51130dc]
  - @acanthis-dec/browser-fetch@1.0.2
  - @acanthis-dec/core@1.0.2
  - @acanthis-dec/deobfuscator@1.0.2
  - @acanthis-dec/storage@1.0.2

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
