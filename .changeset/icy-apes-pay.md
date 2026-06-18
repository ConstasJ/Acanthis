---
"@acanthis-dec/linovelib": patch
---

就封面获取相关功能进行了一轮重构
- 删去了无用的LinovelibClient.getNovelCover方法和getCover函数
- 新增了getNovelCoverUrl和getVolumeCoverUrl函数，直接从小说页面获取小说封面URL，从小说目录获取卷封面URL
- 为LinovelibClient新增了getNovelCover和getVolumeCover两个方法，基于上面两个函数封装成可以一次性获取URL和数据的方法