# @acanthis-dec/cli

[English README](./README.md) | [工作区 README](../../README.zh-CN.md)

Acanthis 的双模 EPUB 3.0 导出命令行工具（`acanthis`）。通过连接 `@acanthis-dec/api-server` 服务端，支持以可脚本化的子命令或终端交互向导两种方式浏览书库、搜索作品、查看详情并将轻小说导出为标准 EPUB 3.0 电子书（支持按卷拆分与整书合并两种模式）。

## 安装方式

### 方式一：通过 npm / Node.js 使用

```bash
npm install -g @acanthis-dec/cli
# 或免全局安装直接运行
npx @acanthis-dec/cli --help
```

### 方式二：单文件二进制（GitHub Releases / Homebrew / WinGet）

可从 GitHub Releases 下载对应平台（`Windows x64`、`Linux x64/arm64`、`macOS arm64/x64`）的预编译压缩包并核对 `SHA256SUMS.txt`，或在配置好对应软件源后通过 WinGet / Homebrew 安装。

## 使用模式

### 交互式向导（TTY 终端）

在交互式终端中不带参数直接运行 `acanthis` 即可启动向导：

```bash
acanthis
```

向导会自动探测服务端连通性（不可达时引导输入新的 `serverUrl` 或访问令牌并可选保存），支持选择书源、浏览服务端已缓存书库、关键词搜索或直接输入作品 ID/URL，随后多选目标分卷、选择 `split` / `merged` 模式并实时展示导出进度。

> 在**非 TTY 环境**（如 CI 流水线或管道重定向）下不带子命令调用 `acanthis` 时，会直接打印帮助并以退出码 `1` 退出，绝不挂起等待输入。

### 子命令一览

#### `acanthis export <novelIdOrUrl>`

按作品数字 ID 或作品页面链接（如 `https://www.linovelib.com/novel/3590.html`）导出 `.epub` 文件。

| 参数                     | 短参数 | 默认值                           | 说明                                                                                                              |
| ------------------------ | ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--server <url>`         | `-s`   | 配置值 / `http://localhost:5301` | Acanthis API 服务端基础地址                                                                                       |
| `--source <platform>`    | —      | 配置值 / `linovelib`             | 书源标识                                                                                                          |
| `--token <token>`        | `-t`   | 配置值 / 未设置                  | 可选 Bearer 访问令牌                                                                                              |
| `--output <dir>`         | `-o`   | 配置值 / `.`                     | 输出基目录（支持相对路径与 `~`；默认在其下以 `<书名>` 创建子目录）                                                |
| `--no-subdir`            | —      | `subdir = true`                  | 直接将 EPUB 文件写入输出基目录，不创建 `<书名>` 子目录                                                            |
| `--mode <split\|merged>` | `-m`   | `split`                          | `split` 按分卷输出 `[作者] 书名 - 分卷名.epub`；`merged` 合并输出 `[作者] 书名.epub`（选定部分分卷时为 `(选集)`） |
| `--merged`               | —      | `false`                          | 快捷开关，等价于 `--mode merged`                                                                                  |
| `--volumes <spec>`       | `-v`   | 全部分卷                         | 逗号分隔的 1 基卷序号、闭区间（如 `1,3-5`）或分卷 ID                                                              |
| `--no-illustrations`     | —      | `illustrations = true`           | 跳过章节插图下载（仅保留封面，正文中缺失插图将替换为占位提示）                                                    |
| `--strict`               | —      | `false`                          | 遇到未决 `TOBEDETERMINED` 章节或章节/插图重试耗尽时立即以退出码 `1` 中止（无封面分卷 `404` 始终自动降级容错）     |
| `--overwrite`            | —      | `false`                          | 覆盖已存在的同名 `.epub` 文件（默认跳过）                                                                         |
| `--json`                 | —      | `false`                          | 仅向 `stdout` 输出单行结构化 JSON 结果；所有进度与警告均输出至 `stderr`                                           |

#### `acanthis search <keyword>`

在指定书源上按关键词搜索作品。

- 选项：`-s, --server <url>`、`--source <platform>`、`-t, --token <token>`、`--json`

#### `acanthis list`

分页列出服务端已缓存的书库作品。

- 选项：`--page <number>`、`--page-size <number>`、`-s, --server <url>`、`--source <platform>`、`-t, --token <token>`、`--json`

#### `acanthis sources`

调用 `GET /v1/sources` 列出服务端当前可用书源。

- 选项：`-s, --server <url>`、`-t, --token <token>`、`--json`

#### `acanthis info <novelIdOrUrl>`

展示作品元数据、1 基分卷序号、章节数量及未决 `TOBEDETERMINED` 章节警告。

- 选项：`-s, --server <url>`、`--source <platform>`、`-t, --token <token>`、`--json`

#### `acanthis config <action> [key] [value]`

管理本地持久化配置文件。

- 支持动作：
  - `acanthis config path [--json]` — 输出配置文件路径
  - `acanthis config list [--json]` — 列出已保存配置与最终生效配置
  - `acanthis config get <key> [--json]` — 读取单个配置项
  - `acanthis config set <key> <value> [--json]` — 原子写入更新配置项
  - `acanthis config reset [--json]` — 删除本地配置文件恢复默认
- 允许的配置键白名单：`serverUrl`、`token`、`defaultSource`、`outputDir`

## 配置优先级与环境变量

配置按以下 4 级优先级生效（从高到低）：

1. **CLI 显式参数**（`--server`、`--token`、`--source`、`--output`）
2. **环境变量**（空字符串自动忽略）：
   - `ACANTHIS_SERVER_URL`
   - `ACANTHIS_API_TOKEN`
   - `ACANTHIS_SOURCE`
   - `ACANTHIS_OUTPUT_DIR`
3. **用户配置文件**：
   - Windows：`%APPDATA%\acanthis\config.json`
   - macOS / Linux：`${XDG_CONFIG_HOME:-~/.config}/acanthis/config.json`
4. **内置默认值**：
   - `serverUrl`：`http://localhost:5301`
   - `defaultSource`：`linovelib`
   - `outputDir`：`.`
   - `token`：未设置

## 退出码说明

| 退出码 | 含义                                                                          |
| ------ | ----------------------------------------------------------------------------- |
| `0`    | 执行成功                                                                      |
| `1`    | 运行期错误、网络错误、鉴权失败（`401`）、`--strict` 中止或非 TTY 无子命令调用 |
| `2`    | CLI 参数无效、输入校验失败或配置文件错误（`CliConfigError`）                  |
