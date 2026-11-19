# @acanthis-dec/cli

[中文文档](./README.zh-CN.md) | [Workspace README](../../README.md)

Dual-mode EPUB 3.0 export CLI (`acanthis`) for Acanthis. It connects to an `@acanthis-dec/api-server` instance to browse, search, inspect, and export light novels into standard EPUB 3.0 ebooks (both per-volume split mode and multi-volume merged mode) via either scriptable CLI subcommands or an interactive terminal wizard.

## Installation

### Option 1: npm / Node.js

```bash
npm install -g @acanthis-dec/cli
# or run without installing globally
npx @acanthis-dec/cli --help
```

### Option 2: Standalone Binary (GitHub Releases / Homebrew / WinGet)

Download the precompiled binary archive for your platform (`Windows x64`, `Linux x64/arm64`, `macOS arm64/x64`) from GitHub Releases, verify its checksum against `SHA256SUMS.txt`, or install via WinGet / Homebrew when published to your tap/manifest repository.

## Usage Modes

### Interactive Wizard (TTY)

Running `acanthis` with no arguments in an interactive terminal launches the guided wizard:

```bash
acanthis
```

The wizard probes server connectivity (prompting for a new `serverUrl` or token if unreachable), lets you select a novel source, browse the cached library, search by keyword, or enter a novel ID/URL directly, multiselect target volumes, pick `split` or `merged` mode, and track export progress.

> Running `acanthis` with no subcommand in a **non-TTY** environment (such as CI or piped stdin/stdout) prints help and exits immediately with exit code `1` without blocking.

### Subcommands

#### `acanthis export <novelIdOrUrl>`

Export a novel (by numeric ID or URL such as `https://www.linovelib.com/novel/3590.html`) to `.epub` file(s).

| Flag                     | Alias | Default                          | Description                                                                                                                                                 |
| ------------------------ | ----- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--server <url>`         | `-s`  | Config / `http://localhost:5301` | Acanthis API server base URL                                                                                                                                |
| `--source <platform>`    | —     | Config / `linovelib`             | Novel source identifier                                                                                                                                     |
| `--token <token>`        | `-t`  | Config / unset                   | Optional Bearer auth token                                                                                                                                  |
| `--output <dir>`         | `-o`  | Config / `.`                     | Output directory                                                                                                                                            |
| `--mode <split\|merged>` | `-m`  | `split`                          | `split` produces `[Author] Title - Volume.epub` per volume; `merged` produces `[Author] Title.epub` (or `(选集)` when subset selected)                      |
| `--merged`               | —     | `false`                          | Shortcut overriding `--mode` to `merged`                                                                                                                    |
| `--volumes <spec>`       | `-v`  | All volumes                      | Comma-separated 1-based indices, ranges (e.g. `1,3-5`), or volume IDs                                                                                       |
| `--no-illustrations`     | —     | `illustrations = true`           | Skip downloading chapter illustrations (covers only; missing images render placeholder text)                                                                |
| `--strict`               | —     | `false`                          | Abort with exit code `1` on unresolved `TOBEDETERMINED` chapters or chapter/illustration retry exhaustion (volume cover `404` always falls back gracefully) |
| `--overwrite`            | —     | `false`                          | Overwrite existing `.epub` files instead of skipping                                                                                                        |
| `--json`                 | —     | `false`                          | Emit only one JSON summary object to `stdout`; all progress and warnings go to `stderr`                                                                     |

#### `acanthis search <keyword>`

Search novels on the configured source.

- Options: `-s, --server <url>`, `--source <platform>`, `-t, --token <token>`, `--json`

#### `acanthis list`

List cached novels stored on the API server.

- Options: `--page <number>`, `--page-size <number>`, `-s, --server <url>`, `--source <platform>`, `-t, --token <token>`, `--json`

#### `acanthis sources`

List available novel sources reported by `GET /v1/sources`.

- Options: `-s, --server <url>`, `-t, --token <token>`, `--json`

#### `acanthis info <novelIdOrUrl>`

Display novel metadata, 1-based volume numbers, chapter counts, and unresolved `TOBEDETERMINED` chapter warnings.

- Options: `-s, --server <url>`, `--source <platform>`, `-t, --token <token>`, `--json`

#### `acanthis config <action> [key] [value]`

Manage persistent user configuration.

- Actions:
  - `acanthis config path [--json]` — Print the config file path
  - `acanthis config list [--json]` — Show stored and resolved config values
  - `acanthis config get <key> [--json]` — Read a single config key
  - `acanthis config set <key> <value> [--json]` — Atomically update a config key
  - `acanthis config reset [--json]` — Remove the persisted config file
- Allowed keys: `serverUrl`, `token`, `defaultSource`, `outputDir`

## Configuration Precedence & Environment Variables

Configuration is resolved in 4 tiers (highest priority first):

1. **CLI flags** (`--server`, `--token`, `--source`, `--output`)
2. **Environment variables** (empty strings are ignored):
   - `ACANTHIS_SERVER_URL`
   - `ACANTHIS_API_TOKEN`
   - `ACANTHIS_SOURCE`
   - `ACANTHIS_OUTPUT_DIR`
3. **User config file**:
   - Windows: `%APPDATA%\acanthis\config.json`
   - macOS / Linux: `${XDG_CONFIG_HOME:-~/.config}/acanthis/config.json`
4. **Built-in defaults**:
   - `serverUrl`: `http://localhost:5301`
   - `defaultSource`: `linovelib`
   - `outputDir`: `.`
   - `token`: unset

## Exit Codes

| Exit Code | Meaning                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `0`       | Success                                                                                      |
| `1`       | Runtime, network, authentication (`401`), `--strict` abort, or non-TTY root invocation error |
| `2`       | Invalid CLI arguments, validation failure, or configuration file error (`CliConfigError`)    |
