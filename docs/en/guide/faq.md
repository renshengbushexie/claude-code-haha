# FAQ


## Q: `undefined is not an object (evaluating 'usage.input_tokens')`

**Cause**: `ANTHROPIC_BASE_URL` is misconfigured. The API endpoint is returning HTML or another non-JSON format instead of a valid Anthropic protocol response.

This project uses the **Anthropic Messages API protocol**. `ANTHROPIC_BASE_URL` must point to an endpoint compatible with Anthropic's `/v1/messages` interface. The Anthropic SDK automatically appends `/v1/messages` to the base URL, so:

- MiniMax: `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic` ✅
- OpenRouter: `ANTHROPIC_BASE_URL=https://openrouter.ai/api` ✅
- OpenRouter (wrong): `ANTHROPIC_BASE_URL=https://openrouter.ai/anthropic` ❌ (returns HTML)

If your model provider only supports the OpenAI protocol, you need a proxy like LiteLLM for protocol translation. See the [Third-Party Models Guide](./third-party-models.md).

## Q: `Cannot find package 'bundle'`

```
error: Cannot find package 'bundle' from '.../claude-code-haha/src/entrypoints/cli.tsx'
```

**Cause**: Your Bun version is too old and doesn't support the required `bun:bundle` built-in module.

**Fix**: Upgrade Bun to the latest version:

```bash
bun upgrade
```

## Q: How to use OpenAI / DeepSeek / Ollama or other non-Anthropic models?

This project only supports the Anthropic protocol. If your model provider doesn't natively support the Anthropic protocol, you need a proxy like [LiteLLM](https://github.com/BerriAI/litellm) for protocol translation (OpenAI → Anthropic).

See the [Third-Party Models Guide](./third-party-models.md) for detailed setup instructions.

## Q: Startup toast `Failed to install Anthropic marketplace · Will retry on next startup`

**Symptom**: A yellow warning toast appears in the bottom-left of the TUI on startup, saying the official Anthropic marketplace failed to install.

**Cause**: On startup the CLI tries to install the official plugin marketplace from two sources:

1. GCS mirror: `https://downloads.claude.ai/...`
2. Git clone fallback: `github.com/anthropics/claude-plugins-official`

In some networks (e.g. mainland China without a proxy) both endpoints are unreachable and the install fails. This **does not affect core CLI functionality** — it only affects the official plugin catalog under the `/plugin` command.

**Important**: The failure state is persisted to `~/.claude.json` and retried with **exponential backoff** (1h → 2h → 4h → … capped at 1 week, max 10 attempts). So **ignoring the toast is safe** — it will not retry on every startup and will never block the CLI.

**Three ways to handle it (pick one)**:

1. **Just ignore it**: the toast is harmless and retries are already backed off
2. **Disable auto-install (silent)**: set in `.env` or your shell environment:

   ```env
   CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1
   ```

   The CLI will stop attempting installs and stop showing the toast. You can still manage marketplaces manually via the `/plugin` command
3. **Configure a network proxy**: if you actually need the official marketplace, set `HTTPS_PROXY` in your shell so GCS / GitHub become reachable
