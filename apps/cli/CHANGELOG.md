# @acanthis-dec/cli

## 0.2.1

### Patch Changes

- Updated dependencies [e33a4c1]
  - @acanthis-dec/core@1.3.0

## 0.2.0

### Minor Changes

- ea233c5: 优化 CLI 导出进度展示体验：在导出进度事件中补充所属分卷、卷内计数与章节状态并复用向导已拉取的小说详情；新增多进度条终端渲染器，在交互向导与 `export` 命令的 TTY 模式下实时展示总进度条、当前 `Volume › Chapter` 活跃上下文及各分卷独立进度条（支持 CJK 宽字符对齐与多卷滑动窗口），并在非 TTY / `--json` 模式下输出带卷名的精简进度日志

## 0.1.0

### Minor Changes

- 125e219: 首次发布远程导出命令行工具 `@acanthis-dec/cli`（`acanthis`）：支持命令行参数 / `--json` 自动化与 `@clack/prompts` 交互式向导双模式、多书源发现与 `--source`/`--token` 四层配置解析、URL 重定基、串行拉章与并发去重拉图容错导出，以及多平台单文件二进制与 WinGet/Homebrew 发布流水线

### Patch Changes

- Updated dependencies [125e219]
- Updated dependencies [125e219]
- Updated dependencies [125e219]
  - @acanthis-dec/core@1.2.0
  - @acanthis-dec/epub@0.1.0
