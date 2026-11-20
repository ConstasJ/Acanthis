---
"@acanthis-dec/browser-fetch": patch
---

FlareSolverr 自动解盾成功后，对非二进制的 2xx 文本与 JSON 响应直接复用返回的 `solution.response`（同时照常持久化 `cf_clearance`），避免在宿主与容器出口 IP 不一致或漂移时因重放再次触发 Cloudflare 403 拦截。
