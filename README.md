# GetNote Toolbox for DeepSeek Harness

A native DeepSeek Harness (DSH) Host plugin that turns the local `getnote` CLI
into 15 structured tools for notes, tags, and knowledge bases.

> 中文说明为主；给英文读者的摘要：this is an MIT-licensed DSH Host bundle that
> wraps the local `getnote` CLI. It never reads or echoes API keys. It is not
> published to npm; install it as a local bundle. See [Security](#security).

## 状态

- Version `1.2.0`
- 15 tools, Config schema, bundled guidance Skill
- Node.js >= 20
- Tests: `pnpm test` (28 tests, fake CLI, no network)
- CI: Node 20/22, Linux/macOS
- 仓库：<https://github.com/leether/getnote-toolbox>
- 公开源码，但**尚未发布到 npm**；`package.json` 仍为 `"private": true`

## 能力

| Tool | 作用 |
| --- | --- |
| `getnote_auth_status` | 检查本机 GetNote 登录状态（不读取、不回显凭证） |
| `getnote_search` | 语义搜索笔记，可限定知识库 |
| `getnote_save` | 保存文字、网页链接或本地图片，可设标题和标签 |
| `getnote_recent_notes` | 列出最近笔记 |
| `getnote_note` | 按 ID 读取笔记详情与正文 |
| `getnote_update_note` | 更新标题、正文或标签 |
| `getnote_delete_note` | 移入回收站（必须显式 `confirm: true`） |
| `getnote_tag` | 查看 / 添加 / 按标签 ID 删除标签 |
| `getnote_list_knowledge_bases` | 列出自有或订阅的知识库 |
| `getnote_kb_notes` | 列出某个知识库内的笔记 |
| `getnote_create_kb` | 创建个人知识库 |
| `getnote_add_notes_to_kb` | 把一条或多条笔记加入知识库 |
| `getnote_remove_notes_from_kb` | 从知识库移除笔记（不删除笔记本身） |
| `getnote_task` | 查询保存任务的异步进度 |
| `getnote_quota` | 查看 API 读写配额 |

另带一个内置引导 Skill `getnote-toolbox`，让 Agent 优先选择原生工具，并在写操作、
标签覆盖、删除确认和登录提示上遵循统一规则。

## 前置条件

- DeepSeek Harness Desktop / Host，支持本地 bundle；
- Node.js >= 20；
- 本机已安装并登录 GetNote CLI：

```bash
getnote auth status
getnote auth login   # 未登录时
```

插件不保存 API Key，也不直接调用得到大脑 API；认证由本机 `getnote` CLI 负责。

## 安装

这个仓库目前是**源码 bundle**，没有发布到 npm。先克隆仓库，再用你所用 DSH 版本的
本地 bundle / link 流程安装本目录，并确认 `cordis.patch.yml` 被加载：

```bash
git clone https://github.com/leether/getnote-toolbox.git
```

插件按以下顺序查找可执行文件：

1. Config 的 `binaryPath`（最高优先级）
2. 环境变量 `GETNOTE_BIN`（绝对路径）
3. `PATH` 中的 `getnote`
4. 常见安装目录（`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin` 等）
5. `npx --yes --package @getnote/cli@latest -- getnote` 兜底

> 如果 `PATH` 里有多个 `getnote`，建议显式设置 `binaryPath`，避免版本错位。

### 与官方插件冲突

本插件使用 `getnote_*` 工具名，与官方 `@getnote/dsh-plugin` 相同。**不要在同一个
profile 里同时安装两者**，否则后注册者会产生工具名冲突。

## 配置

插件导出 `Config` schema，可在 profile 的 `cordis.patch.yml` 覆盖：

```yaml
- id: getnote-toolbox
  config:
    binaryPath: /opt/homebrew/bin/getnote
    apiUrl: http://127.0.0.1:8080
    timeoutMs: 120000
    maxOutputBytes: 16777216
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `binaryPath` | 自动发现 | `getnote` 可执行文件绝对路径；优先于 `GETNOTE_BIN` 和 PATH |
| `apiUrl` | CLI 默认 | 设置 `GETNOTE_API_URL`，仅用于联调/私有环境 |
| `timeoutMs` | `120000` | 单次命令超时（最小 1000） |
| `maxOutputBytes` | `16777216` | 单次命令输出上限（最小 1024） |

> 覆盖某个 entry 的 `config` 会替换整份配置；要保留的字段请一并写上。

环境变量作为兜底（Config > 环境变量 > 内置默认）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GETNOTE_BIN` | 自动发现 | `getnote` 可执行文件绝对路径 |
| `GETNOTE_TIMEOUT_MS` | `120000` | 单次命令超时 |
| `GETNOTE_MAX_OUTPUT_BYTES` | `16777216` | 单次命令输出上限 |

## Security

- 参数通过数组传给 `spawn`，不经过 Shell；
- 不提供任意命令入口，只暴露明确的 `getnote_*` 操作；
- 不读取、不缓存、不回显 API Key；认证由本地 CLI 管理；
- 删除笔记必须显式 `confirm: true`；
- 单次命令有超时和输出体积上限；
- 插件会把 Host 进程环境传给 `getnote` 子进程，因此应把 CLI 本身视为受信任边界；
- `npx` 兜底会下载 `@getnote/cli@latest`；如果在意供应链风险，请用 `binaryPath` 固定本地版本。

发现安全问题请先看 [SECURITY.md](SECURITY.md)。不要在公开 issue 里贴 API Key、真实笔记
ID、标题或正文。

## 开发

```bash
pnpm install
pnpm run check
pnpm test
npm pack --dry-run
```

测试使用 `test/fixtures/fake-getnote.mjs`，不访问网络、不需要真实账号。

可选的只读真实 CLI 冒烟测试：

```bash
node scripts/smoke.mjs
```

它会在终端打印少量真实搜索结果/笔记片段。运行后不要把输出直接贴到 issue 或聊天中。

## 已知限制

- 与官方 `@getnote/dsh-plugin` 工具名冲突，不能同时安装；
- 列表的 `limit` 在旧 CLI 上可能只是分页大小，插件会按返回结果自行截断；
- 本地图片请用绝对路径；`~/` 会展开；
- CLI 没有公开的笔记链接字段，插件不拼造链接；
- 已在 `getnote` 1.1.1 和 1.8.0 上验证；建议使用 1.5.3+；
- 内置 Skill 仅在 Harness 提供 `skills` 服务时注册。

## 设计文档

- [docs/DESIGN.md](docs/DESIGN.md)：CLI / Tool / Skill 分层、契约、安全与测试
- [CHANGELOG.md](CHANGELOG.md)：版本变化
- [RELEASING.md](RELEASING.md)：打包与本地/registry 发布流程

## 致谢

架构参考了官方 [@getnote/dsh-plugin](https://github.com/iswalle/getnote-dsh-plugin)
（MIT，Copyright GetNote）；本项目是独立重写，并扩展了写操作、Config schema、内置
Skill 和兼容性处理。

## License

MIT，见 [LICENSE](LICENSE)。书稿正文的 CC BY-NC-ND 许可不适用于本代码仓库。
