# Environment Variables


| Variable | Required | Description |
|------|------|------|
| `ANTHROPIC_API_KEY` | One of two | API key sent via the `x-api-key` header |
| `ANTHROPIC_AUTH_TOKEN` | One of two | Auth token sent via the `Authorization: Bearer` header |
| `ANTHROPIC_BASE_URL` | No | Custom API endpoint, defaults to Anthropic |
| `ANTHROPIC_MODEL` | No | Default model (**lower priority than the `/model` command**, see note below) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No | Sonnet-tier model mapping |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | No | Haiku-tier model mapping |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | No | Opus-tier model mapping |
| `API_TIMEOUT_MS` | No | API request timeout, default `600000` (10min) |
| `DISABLE_TELEMETRY` | No | Set to `1` to disable telemetry |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | No | Set to `1` to disable non-essential network traffic |
| `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` | No | Set to `1` to disable auto-installing the official plugin marketplace at startup. See [FAQ](./faq.md) |

## Configuration Methods

### Option 1: `.env` File

```bash
cp .env.example .env
```

Edit `.env` (the example below uses [MiniMax](https://platform.minimaxi.com/subscribe/token-plan?code=1TG2Cseab2&source=link) as the API provider — you can replace it with any compatible service):

```env
# API authentication (choose one)
ANTHROPIC_API_KEY=sk-xxx          # Standard API key via x-api-key header
ANTHROPIC_AUTH_TOKEN=sk-xxx       # Bearer token via Authorization header

# API endpoint (optional, defaults to Anthropic)
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic

# Model configuration
ANTHROPIC_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7-highspeed

# Timeout in milliseconds
API_TIMEOUT_MS=3000000

# Disable telemetry and non-essential network traffic
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### Option 2: `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL": "MiniMax-M2.7-highspeed"
  }
}
```

> Priority: Environment variables > `.env` file > `~/.claude/settings.json`

## Model Selection Priority (`ANTHROPIC_MODEL` vs `/model`)

cc-haha resolves the runtime model in the following order (higher overrides lower):

1. **Runtime overrides** (e.g. plan-mode temporary switch, `--model` CLI flag)
2. **Model picked via `/model`** (persisted to the `model` field in `~/.claude/settings.json`)
3. **`ANTHROPIC_MODEL` environment variable**
4. Tier mapping variables (`ANTHROPIC_DEFAULT_SONNET_MODEL`, etc.)
5. Built-in default model

> ⚠️ **Behavior change (fixes [#191](https://github.com/NanmiCoder/cc-haha/issues/191) / [#196](https://github.com/NanmiCoder/cc-haha/issues/196) / [#202](https://github.com/NanmiCoder/cc-haha/issues/202))**: In earlier builds `ANTHROPIC_MODEL` outranked `/model`, so `/model` selections did not persist. After the fix, `/model` writes to `~/.claude/settings.json` and overrides `ANTHROPIC_MODEL`. If you prefer the old env-wins behavior, delete the `model` field from `~/.claude/settings.json` or pick `Use default` in the `/model` menu (resets to built-in default).

