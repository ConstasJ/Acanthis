# @acanthis-dec/linovelib

## 1.3.0

### Minor Changes

- 125e219: 补齐多端底座能力：新增书源能力描述与 `/v1/sources` 发现接口、CORS 与可选 `AUTH_TOKEN` Bearer 鉴权、章节插图提取重写与封闭式磁盘缓存代理 `/v1/linovelib/illustration/:hash`、书库分页 `/v1/linovelib/novels`、章节直链 `?novelId=` 兜底、目录隐藏章节 ID 双向推导与事务残留清理，并修复已缓存作品离线降级与冷库迁移初始化竞态问题

### Patch Changes

- Updated dependencies [125e219]
- Updated dependencies [125e219]
  - @acanthis-dec/core@1.2.0
  - @acanthis-dec/storage@1.1.0

## 1.2.0

### Minor Changes

- 6c2a0e8: 新增 V3 搜索实现：站点改为图片验证码后，旧 search_guard 验证流程已失效；V3 会串行化搜索、遵守站点 5 秒搜索间隔、自动识别并提交验证码、复用约 30 分钟验证态，并处理验证过期后的分页请求

### Patch Changes

- Updated dependencies [2b43002]
  - @acanthis-dec/browser-fetch@1.1.2
  - @acanthis-dec/storage@1.0.8

## 1.1.2

### Patch Changes

- 99cbf29: 修复了 searchTicket 的行为异常

## 1.1.1

### Patch Changes

- 19203d3: 修正行为，如果搜索页结果为空则直接报错
- Updated dependencies [e5ea7d6]
- Updated dependencies [8654d2b]
  - @acanthis-dec/browser-fetch@1.1.1
  - @acanthis-dec/storage@1.0.7

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
