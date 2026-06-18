# @acanthis-dec/storage

## 1.0.4

### Patch Changes

- Updated dependencies [10ea62d]
  - @acanthis-dec/browser-fetch@1.0.3

## 1.0.3

### Patch Changes

- 27ddae6: 解决了几个关于 novelCacheMeta 的问题。

  - 解决了 addNovelCoverMeta 和 addVolumeCoverMeta 中没有对 onConflictDoNothing 的调用，导致重复插入时抛出异常的问题。
  - addNovelCoverMeta 现在会在 novel 找不到时，尝试插入一个新的空 novel 记录，以便后续可以复用本地 cover 缓存。

## 1.0.2

### Patch Changes

- 51130dc: Fix published `types` metadata to point at generated declaration files.
- Updated dependencies [51130dc]
  - @acanthis-dec/browser-fetch@1.0.2
  - @acanthis-dec/core@1.0.2

## 1.0.1

### Patch Changes

- build(npm): 为 package.json 添加 types 字段，确保 npm 可以正确识别出这是一个有类型声明的包
- Updated dependencies
  - @acanthis-dec/browser-fetch@1.0.1
  - @acanthis-dec/core@1.0.1

## 1.0.0

### Major Changes

- 初次发版，基本完成了首次重构，真不容易

### Patch Changes

- Updated dependencies
  - @acanthis-dec/browser-fetch@1.0.0
  - @acanthis-dec/core@1.0.0
