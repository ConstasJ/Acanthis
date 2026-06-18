---
"@acanthis-dec/browser-fetch": patch
---

修复了 detectCFBlock 和 pRetry 的重试回调中的几个问题
- detectCFBlock 中加入了对 429 的检测，确保在 Cloudflare 的速率限制下也能正确识别被封锁的情况
- pRetry 的三个回调（onFailedAttempt、onFailedAttemptAsync、onRetry）全部改为 async 包装，确保在回调中进行异步操作时能够正确等待，避免出现“非预期并发”行为