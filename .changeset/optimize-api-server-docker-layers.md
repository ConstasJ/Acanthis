---
"@acanthis-dec/api-server": patch
---

拆分 api-server 运行时基础镜像、精简原生依赖与 libcurl-impersonate 产物，并启用 zstd 镜像层压缩与共享构建缓存，大幅降低每次拉取新版本镜像的增量下载体积。
