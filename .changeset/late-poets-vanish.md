---
"@acanthis-dec/browser-fetch": patch
---

- 修复了 expires 和 maxAge 无法正确透传到上层 cookieStore 的问题
- 添加了处理maxAge为0或负数的逻辑，确保在这种情况下不会将cookie存储到cookieStore中