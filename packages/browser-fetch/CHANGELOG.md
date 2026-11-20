# @acanthis-dec/browser-fetch

## 1.1.3

### Patch Changes

- 6716664: 完善插图与封面抓取链路的 Cloudflare 拦截处理：`browser-fetch` 在未启用 FlareSolverr 或重复挑战时统一抛出 `CloudflareBlockError`；`linovelib` 新增 `NovelMediaQueue` 提供串行限速、共享冷却、同 URL 去重、标准图片请求头及 Cloudflare 阶梯退避重试并合并并发会话校验；`api-server` 为 `/illustration/:hash` 增加单飞缓存合并并将 `CloudflareBlockError`/`FlareSolverrError`/`404`/`5xx` 映射为带 `Cache-Control: no-store` 与 `Retry-After` 的规范 HTTP 状态码

## 1.1.2

### Patch Changes

- 2b43002: 修复 FileCookiesStore 从不持久化的问题：改为懒加载磁盘文件，并在写入/删除/清空后自动落盘，读取时恢复时间字段的 Date 类型

## 1.1.1

### Patch Changes

- e5ea7d6: - 修复了 expires 和 maxAge 无法正确透传到上层 cookieStore 的问题
  - 添加了处理 maxAge 为 0 或负数的逻辑，确保在这种情况下不会将 cookie 存储到 cookieStore 中

## 1.1.0

### Minor Changes

- 8949718: 实现了若干个实用工具

### Patch Changes

- 2c8596b: 修正了 Chrome 150 不正确的 Sec-Ch-Ua 标头

## 1.0.4

### Patch Changes

- 7c60833: 新增了 Chrome 150 的 porfile，同时重构了 profile 体系

## 1.0.3

### Patch Changes

- 10ea62d: 修复了 detectCFBlock 和 pRetry 的重试回调中的几个问题
  - detectCFBlock 中加入了对 429 的检测，确保在 Cloudflare 的速率限制下也能正确识别被封锁的情况
  - pRetry 的三个回调（onFailedAttempt、onFailedAttemptAsync、onRetry）全部改为 async 包装，确保在回调中进行异步操作时能够正确等待，避免出现“非预期并发”行为

## 1.0.2

### Patch Changes

- 51130dc: Fix published `types` metadata to point at generated declaration files.

## 1.0.1

### Patch Changes

- build(npm): 为 package.json 添加 types 字段，确保 npm 可以正确识别出这是一个有类型声明的包

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易
