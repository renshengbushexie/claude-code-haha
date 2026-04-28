# 常见问题


## Q: `undefined is not an object (evaluating 'usage.input_tokens')`

**原因**：`ANTHROPIC_BASE_URL` 配置不正确，API 端点返回的不是 Anthropic 协议格式的 JSON，而是 HTML 页面或其他格式。

本项目使用 **Anthropic Messages API 协议**，`ANTHROPIC_BASE_URL` 必须指向一个兼容 Anthropic `/v1/messages` 接口的端点。Anthropic SDK 会自动在 base URL 后面拼接 `/v1/messages`，所以：

- MiniMax：`ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic` ✅
- OpenRouter：`ANTHROPIC_BASE_URL=https://openrouter.ai/api` ✅
- OpenRouter 错误写法：`ANTHROPIC_BASE_URL=https://openrouter.ai/anthropic` ❌（返回 HTML）

如果你的模型供应商只支持 OpenAI 协议，需要通过 LiteLLM 等代理做协议转换，详见 [第三方模型使用指南](./third-party-models.md)。

## Q: `Cannot find package 'bundle'`

```
error: Cannot find package 'bundle' from '.../claude-code-haha/src/entrypoints/cli.tsx'
```

**原因**：Bun 版本过低，不支持项目所需的 `bun:bundle` 等内置模块。

**解决**：升级 Bun 到最新版本：

```bash
bun upgrade
```

## Q: 怎么接入 OpenAI / DeepSeek / Ollama 等非 Anthropic 模型？

本项目只支持 Anthropic 协议。如果模型供应商不直接支持 Anthropic 协议，需要用 [LiteLLM](https://github.com/BerriAI/litellm) 等代理做协议转换（OpenAI → Anthropic）。

详细配置步骤请参考：[第三方模型使用指南](./third-party-models.md)

## Q: 启动时提示 `Failed to install Anthropic marketplace · Will retry on next startup`

**现象**：启动 TUI 时左下角弹出黄色警告 toast，提示官方插件市场（Anthropic marketplace）安装失败。

**原因**：CLI 启动时会尝试从两个源安装官方插件市场：

1. GCS 镜像：`https://downloads.claude.ai/...`
2. 回退到 git clone：`github.com/anthropics/claude-plugins-official`

国内网络环境下两个域名常常都无法直连，安装会失败。这**不影响 CLI 核心功能**，只影响 `/plugin` 命令下的官方插件目录。

**重要**：失败状态会持久化到 `~/.claude.json`，并以**指数退避重试**（1 小时 → 2h → 4h → … 上限 1 周，最多 10 次），所以**忽略这条 toast 也是安全的**——不会每次启动都重试，更不会阻塞 CLI。

**三种处理方式（任选其一）**：

1. **直接忽略**：toast 不影响功能，重试机制会自动退避
2. **禁用自动安装（静默）**：在 `.env` 或 shell 环境变量中设置：

   ```env
   CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1
   ```

   设置后 CLI 不再尝试安装、不再弹 toast；如需手动管理插件市场可用 `/plugin` 命令
3. **配置网络代理**：如果你确实需要官方插件市场，给 shell 设置 `HTTPS_PROXY` 让 GCS / GitHub 可达即可

## Q: 接入阿里 Qwen / DashScope 报 401，或日志里出现 `Auth conflict` / 「Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY are set」

**症状**：把 `ANTHROPIC_BASE_URL` 改到 `https://coding.dashscope.aliyuncs.com/apps/anthropic`（或 LongCat 等其他 Anthropic 兼容端点）之后，启动就报 401，或日志里出现 `Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY are set` 警告。

**根因**：你**同时**设置了 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN`，Anthropic SDK 会同时发送 `x-api-key` 和 `Authorization: Bearer` 两个认证头，DashScope / LongCat 等严格校验的端点会判定为认证冲突直接拒绝。

**解决**：

1. 只保留 `ANTHROPIC_AUTH_TOKEN`，从下列**所有位置**清除 `ANTHROPIC_API_KEY`：
   - `.env`
   - 当前 shell（`unset ANTHROPIC_API_KEY` / PowerShell `Remove-Item Env:\ANTHROPIC_API_KEY`）
   - `~/.claude/settings.json` 的 `env` 字段
   - `~/.bashrc` / `~/.zshrc` / Windows 系统环境变量
2. 自检：

   ```bash
   # macOS / Linux
   env | grep -i anthropic
   # Windows PowerShell
   Get-ChildItem Env:ANTHROPIC*
   ```

   输出里**不能出现** `ANTHROPIC_API_KEY`。
3. 顺便确认 `ANTHROPIC_MODEL` 用的是 DashScope 官方模型 ID（如 `qwen3-coder-plus`），不是 `qwen` / `claude-3-sonnet` 之类的别名。

详见 [第三方模型使用指南 §8 阿里 DashScope / Qwen 接入常见问题](./third-party-models.md#_8-阿里-dashscope-qwen-接入常见问题重要)。

## Q: 接入 Qwen 提示「找不到该大模型」

**根因**：`ANTHROPIC_MODEL` 写成了别名而非 DashScope 官方模型 ID。

✅ 正确：`qwen3-coder-plus` / `qwen3-coder` / `qwen-max` / `qwen-plus` / `qwen-turbo`
❌ 错误：`qwen` / `qwen3` / `coder` / `claude-3-sonnet`

完整模型列表见阿里云控制台「百炼」→「模型广场」。注意 `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` 三个回退变量也要一并改成官方 ID，否则在某些场景下仍会用回旧的 Claude 模型名。

## Q: Ollama / LMStudio 多轮对话「忘记」工具结果，或工具调用进入死循环

**症状**：接入本地 Ollama / LMStudio + Gemma 3/4 等模型时，第二轮起模型无视前面工具的执行结果、反复调用同一个工具、或干脆停止调用工具。

**根因有三层，proxy 只能修第一层**：

| 层 | 问题 | 谁来修 |
|---|---|---|
| Proxy 转换层 | 上游不返回 `tool_call.id` 时 → Anthropic 客户端无法配对多轮 tool_use ↔ tool_result；助手 thinking 块在多轮对话中被丢弃 | **本项目已修复 (#195)**：合成 fallback id + thinking 以 `<thinking>` 标签保留进 prompt |
| Ollama 配置 | `num_ctx` 默认 12K，但 Claude Code system prompt + 工具定义就 30K+，工具定义被静默截断 | **必须自己改**：把模型 `num_ctx` 改到 ≥ 32768 |
| 模型本身 | Gemma 3 / 4 工具调用训练数据稀缺，多轮场景不稳定（Ollama #9680 / #15241） | **换模型**：推荐 `qwen2.5-coder:14b+`、`llama3.1:8b+` |

详细操作步骤见 [第三方模型使用指南 §7 本地模型工具调用与多轮上下文](./third-party-models.md#7-本地模型ollama--lmstudio工具调用与多轮上下文重要)。

## Q: 可以用 LMStudio 启动 Gemma 4 接入 cc-haha 吗？

可以。推荐使用 LMStudio 的原生 Anthropic-compatible 端点：

```env
ANTHROPIC_AUTH_TOKEN=lmstudio
ANTHROPIC_BASE_URL=http://localhost:1234
ANTHROPIC_MODEL=google/gemma-4-31b
ANTHROPIC_DEFAULT_SONNET_MODEL=google/gemma-4-31b
ANTHROPIC_DEFAULT_HAIKU_MODEL=google/gemma-4-31b
ANTHROPIC_DEFAULT_OPUS_MODEL=google/gemma-4-31b
API_TIMEOUT_MS=3000000
```

注意三点：

1. `ANTHROPIC_BASE_URL` 写 `http://localhost:1234`，不要手动加 `/v1/messages`。
2. `ANTHROPIC_MODEL` 必须和 LMStudio Server 页面显示的模型 ID 完全一致；上面的 `google/gemma-4-31b` 只是示例。
3. Gemma 4 虽然支持 function calling，但在 Claude Code 这种多轮工具调用场景下仍可能不稳定；请把 LMStudio 的 Context Length 拉到 32K+，并优先考虑 Qwen Coder / Llama 3.1 class 模型做 agentic coding。

完整说明见 [第三方模型使用指南 §LMStudio 本地 Anthropic 端点](./third-party-models.md#lmstudio-本地-anthropic-端点gemma-4--本地模型)。
