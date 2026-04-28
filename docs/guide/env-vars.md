# 环境变量说明


| 变量 | 必填 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 二选一 | API Key，通过 `x-api-key` 头发送 |
| `ANTHROPIC_AUTH_TOKEN` | 二选一 | Auth Token，通过 `Authorization: Bearer` 头发送 |
| `ANTHROPIC_BASE_URL` | 否 | 自定义 API 端点，默认 Anthropic 官方 |
| `ANTHROPIC_MODEL` | 否 | 默认模型（**优先级低于 `/model` 命令**，详见下方说明） |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 否 | Sonnet 级别模型映射 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 否 | Haiku 级别模型映射 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 否 | Opus 级别模型映射 |
| `API_TIMEOUT_MS` | 否 | API 请求超时，默认 600000 (10min) |
| `DISABLE_TELEMETRY` | 否 | 设为 `1` 禁用遥测 |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 否 | 设为 `1` 禁用非必要网络请求 |
| `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` | 否 | 设为 `1` 禁用启动时自动安装官方插件市场，详见 [FAQ](./faq.md) |

## 配置方式

### 方式一：`.env` 文件

```bash
cp .env.example .env
```

编辑 `.env`（以下示例使用 [MiniMax](https://platform.minimaxi.com/subscribe/token-plan?code=1TG2Cseab2&source=link) 作为 API 提供商，也可替换为其他兼容服务）：

```env
# API 认证（二选一）
ANTHROPIC_API_KEY=sk-xxx          # 标准 API Key（x-api-key 头）
ANTHROPIC_AUTH_TOKEN=sk-xxx       # Bearer Token（Authorization 头）

# API 端点（可选，默认 Anthropic 官方）
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic

# 模型配置
ANTHROPIC_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7-highspeed

# 超时（毫秒）
API_TIMEOUT_MS=3000000

# 禁用遥测和非必要网络请求
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### 方式二：`~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL": "MiniMax-M2.7-highspeed"
  }
}
```

> 配置优先级：环境变量 > `.env` 文件 > `~/.claude/settings.json`

## 模型选择优先级（`ANTHROPIC_MODEL` vs `/model`）

cc-haha 的运行时模型按以下顺序解析（高优先级覆盖低优先级）：

1. **运行期模型覆写**（如 plan 模式临时切换、`--model` CLI 参数）
2. **`/model` 命令选择的模型**（持久化到 `~/.claude/settings.json` 的 `model` 字段）
3. **`ANTHROPIC_MODEL` 环境变量**
4. 模型映射变量（`ANTHROPIC_DEFAULT_SONNET_MODEL` 等）
5. 内置默认模型

> ⚠️ **行为变更（修复 [#191](https://github.com/NanmiCoder/cc-haha/issues/191) / [#196](https://github.com/NanmiCoder/cc-haha/issues/196) / [#202](https://github.com/NanmiCoder/cc-haha/issues/202)）**：早期版本中 `ANTHROPIC_MODEL` 环境变量优先级高于 `/model`，导致 `/model` 选择无法持久生效。修复后 `/model` 选择会写入 `~/.claude/settings.json` 并优先于 `ANTHROPIC_MODEL`。如果你希望保留 env 优先的旧行为，请删除 `~/.claude/settings.json` 中的 `model` 字段，或在 `/model` 菜单选 `Use default`（重置为内置默认）。

