# @acanthis-dec/linovelib

## 1.4.4

### Patch Changes

- bd1db4a: 增强搜索链路容错与去重并补充全链路可观测 debug 日志：
  
  - `@acanthis-dec/api-server`：将 `SearchRateLimitError` / `SearchVerificationError` 映射为 `503 + Retry-After`；为 `/v1/linovelib/search` 增加 `keyword` `trim()` 归一化、同关键词 single-flight 并发合并与 2 分钟空结果内存负缓存；为 `MemoryTtlCache`（`/home`、`/rankings`、`/catalog`）、`/search`、`/novel`、`/chapter`、`/cover`、带 query 的 HTTP 请求以及服务启动生效配置摘要补充 `debug` 日志。
  - `@acanthis-dec/linovelib`：将 `logger` 注入 `BrowserFetchClient`、`SearchSession`、登录会话与章节解扰链路；加固搜索翻页上限（15 页）、防死循环保护、瞬断重试与验证码提交后的限流页检测；导出 `SearchRateLimitError` 与 `SearchVerificationError`。
  - `@acanthis-dec/browser-fetch`：支持通过 `BrowserFetchClientOptions.logger` 注入可选 logger，记录上游请求耗时/状态、Cloudflare 验证页检测、FlareSolverr 求解耗时与响应复用以及 `pRetry` 重试信息。
- Updated dependencies [bd1db4a]
  - @acanthis-dec/browser-fetch@1.1.7
  - @acanthis-dec/storage@1.2.1

## 1.4.3

### Patch Changes

- Updated dependencies [70f4f56]
  - @acanthis-dec/core@1.4.0
  - @acanthis-dec/storage@1.2.0

## 1.4.2

### Patch Changes

- Updated dependencies [3af0894]
  - @acanthis-dec/browser-fetch@1.1.6
  - @acanthis-dec/storage@1.1.5

## 1.4.1

### Patch Changes

- Updated dependencies [728d7cd]
  - @acanthis-dec/browser-fetch@1.1.5
  - @acanthis-dec/storage@1.1.4

## 1.4.0

### Minor Changes

- e33a4c1: 新增桌面端源站发现能力（全站首页、16 个出版社文库专题、13 个排行榜含完本榜与 7 维书库筛选），并升级 Web 端发现页为 Schema 驱动的四视图浏览体验。

### Patch Changes

- Updated dependencies [e33a4c1]
  - @acanthis-dec/core@1.3.0
  - @acanthis-dec/storage@1.1.3

## 1.3.2

### Patch Changes

- 986b128: 修复插图与封面回源请求在传输停滞时长时间卡死队列的问题：修正 `ImpersTransport` 向 `impers` 传递 `timeout`/`connectTimeout` 的毫秒与秒单位错配（原会导致超时被放大 1000 倍至 8.33 小时），补充 `TCP_KEEPALIVE`、低速停滞检测、JS 兜底超时、损坏会话回收与瞬态 `CurlError` 映射，加固 `FlareSolverrClient` 请求超时；为 `NovelMediaQueue` 补充显式超时、网络重试上限与全生命周期调试日志；在 API Server 中将上游 `NetworkError` 映射为 `502`/`504`（带 `Cache-Control: no-store`）并补充插图回源调试日志
- Updated dependencies [986b128]
  - @acanthis-dec/browser-fetch@1.1.4
  - @acanthis-dec/storage@1.1.2

## 1.3.1

### Patch Changes

- 6716664: 完善插图与封面抓取链路的 Cloudflare 拦截处理：`browser-fetch` 在未启用 FlareSolverr 或重复挑战时统一抛出 `CloudflareBlockError`；`linovelib` 新增 `NovelMediaQueue` 提供串行限速、共享冷却、同 URL 去重、标准图片请求头及 Cloudflare 阶梯退避重试并合并并发会话校验；`api-server` 为 `/illustration/:hash` 增加单飞缓存合并并将 `CloudflareBlockError`/`FlareSolverrError`/`404`/`5xx` 映射为带 `Cache-Control: no-store` 与 `Retry-After` 的规范 HTTP 状态码
- Updated dependencies [6716664]
  - @acanthis-dec/browser-fetch@1.1.3
  - @acanthis-dec/storage@1.1.1

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
