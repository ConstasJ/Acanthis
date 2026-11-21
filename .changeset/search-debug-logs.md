---
"@acanthis-dec/api-server": patch
"@acanthis-dec/linovelib": patch
---

为搜索链路补充可观测 debug 日志：在 `/v1/linovelib/search` 路由中记录搜索缓存命中/未命中、回源耗时、结果数量与异常详情；在 `LinovelibClient` 中将 logger 注入 `SearchSession`，记录搜索锁排队、最小间隔等待、限流重试、验证码抓取与 ONNX 识别详情以及多页翻页解析过程。
