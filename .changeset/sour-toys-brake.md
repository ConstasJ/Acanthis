---
"@acanthis-dec/storage": patch
---

解决了几个关于 novelCacheMeta 的问题。

- 解决了addNovelCoverMeta和addVolumeCoverMeta中没有对onConflictDoNothing的调用，导致重复插入时抛出异常的问题。
- addNovelCoverMeta现在会在novel找不到时，尝试插入一个新的空novel记录，以便后续可以复用本地cover缓存。
