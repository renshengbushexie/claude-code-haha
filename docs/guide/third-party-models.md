# 使用第三方模型（OpenAI / DeepSeek / 本地模型）

本项目基于 Anthropic 协议与 LLM 通信。通过协议转换代理，可以使用 OpenAI、DeepSeek、Ollama 等任意模型。

## 原理

```
claude-code-haha ──Anthropic协议──▶ LiteLLM Proxy ──OpenAI协议──▶ 目标模型 API
                                      (协议转换)
```

本项目发出 Anthropic Messages API 请求，LiteLLM 代理将其自动转换为 OpenAI Chat Completions API 格式并转发给目标模型。

---

## 方式一：LiteLLM 代理（推荐）

[LiteLLM](https://github.com/BerriAI/litellm) 是一个支持 100+ LLM 的统一代理网关（41k+ GitHub Stars），原生支持接收 Anthropic 协议请求。

### 1. 安装 LiteLLM

```bash
pip install 'litellm[proxy]'
```

### 2. 创建配置文件

新建 `litellm_config.yaml`：

#### 使用 OpenAI 模型

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  drop_params: true  # 丢弃 Anthropic 专有参数（thinking 等）
```

#### 使用 DeepSeek 模型

```yaml
model_list:
  - model_name: deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY
      api_base: https://api.deepseek.com

litellm_settings:
  drop_params: true
```

#### 使用 Ollama 本地模型

```yaml
model_list:
  - model_name: llama3
    litellm_params:
      model: ollama/llama3
      api_base: http://localhost:11434

litellm_settings:
  drop_params: true
```

#### 使用多个模型（可在启动后切换）

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  - model_name: deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY
      api_base: https://api.deepseek.com

  - model_name: llama3
    litellm_params:
      model: ollama/llama3
      api_base: http://localhost:11434

litellm_settings:
  drop_params: true
```

### 3. 启动代理

```bash
# 设置目标模型的 API Key
export OPENAI_API_KEY=sk-xxx
# 或
export DEEPSEEK_API_KEY=sk-xxx

# 启动代理
litellm --config litellm_config.yaml --port 4000
```

代理启动后会在 `http://localhost:4000` 监听，并暴露 Anthropic 兼容的 `/v1/messages` 端点。

### 4. 配置本项目

有两种配置方式，任选其一：

#### 方式 A：通过 `.env` 文件

```env
ANTHROPIC_AUTH_TOKEN=sk-anything
ANTHROPIC_BASE_URL=http://localhost:4000
ANTHROPIC_MODEL=gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o
ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-4o
API_TIMEOUT_MS=3000000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

#### 方式 B：通过 `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-anything",
    "ANTHROPIC_BASE_URL": "http://localhost:4000",
    "ANTHROPIC_MODEL": "gpt-4o",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-4o",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-4o",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-4o",
    "API_TIMEOUT_MS": "3000000",
    "DISABLE_TELEMETRY": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

> **说明**：`ANTHROPIC_AUTH_TOKEN` 的值在使用 LiteLLM 代理时可以是任意字符串（LiteLLM 会用自己配置的 key 转发），除非你在 LiteLLM 端设置了 `master_key` 校验。

### 5. 启动并验证

```bash
./bin/claude-haha
```

如果一切正常，你应该能看到正常的对话界面，实际调用的是你配置的目标模型。

---

## 方式二：直连兼容 Anthropic 协议的第三方服务

部分第三方服务直接兼容 Anthropic Messages API，无需额外代理：

### OpenRouter

```env
ANTHROPIC_AUTH_TOKEN=sk-or-v1-xxx
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
ANTHROPIC_MODEL=openai/gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=openai/gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=openai/gpt-4o-mini
ANTHROPIC_DEFAULT_OPUS_MODEL=openai/gpt-4o
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### 阿里 DashScope / Qwen Anthropic 端点（Coding Plan）

阿里云 DashScope 的 **Coding Plan** 提供 Anthropic 协议兼容端点，可以直接接入，无需 LiteLLM 协议转换。

**端点与 Key 说明**：

| 项 | 值 |
|---|---|
| Base URL | `https://coding.dashscope.aliyuncs.com/apps/anthropic` |
| Key 前缀 | `sk-` 开头的 Coding Plan 专用 key（在阿里云控制台「百炼 / Coding Plan」开通获取） |
| 认证方式 | **必须用 `Authorization: Bearer`**，即 `ANTHROPIC_AUTH_TOKEN` 而非 `ANTHROPIC_API_KEY` |
| 推荐模型 | `qwen3-coder-plus` / `qwen3-coder` / `qwen-max` / `qwen-plus` |

```env
# ⚠️ 只设 ANTHROPIC_AUTH_TOKEN，不要再设 ANTHROPIC_API_KEY
ANTHROPIC_AUTH_TOKEN=sk-your-coding-plan-key
ANTHROPIC_BASE_URL=https://coding.dashscope.aliyuncs.com/apps/anthropic
ANTHROPIC_MODEL=qwen3-coder-plus
ANTHROPIC_DEFAULT_SONNET_MODEL=qwen3-coder-plus
ANTHROPIC_DEFAULT_HAIKU_MODEL=qwen3-coder
ANTHROPIC_DEFAULT_OPUS_MODEL=qwen3-coder-plus
API_TIMEOUT_MS=3000000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

> **常见 401 / 「Auth conflict」陷阱**：如果你同时设置了 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN`，
> 上游会同时收到 `x-api-key` 和 `Authorization: Bearer` 两个认证头，DashScope 端点会判定为认证冲突直接 401。
> **解决办法**：只保留 `ANTHROPIC_AUTH_TOKEN`，把 `ANTHROPIC_API_KEY` 从 `.env` / shell / `~/.claude/settings.json` 中**全部删除**（注意三处都要清）。
> 详见下文 [§8 阿里 DashScope / Qwen 接入常见问题](#_8-阿里-dashscope-qwen-接入常见问题重要)。

### MiniMax（已在 .env.example 中配置）

MiniMax 提供 Anthropic 兼容接口，支持直接接入，无需代理。可用模型：

| 模型 | 说明 |
|------|------|
| `MiniMax-M2.7` | 默认推荐，综合性能优秀 |
| `MiniMax-M2.7-highspeed` | 响应更快，适合对速度有要求的场景 |

```env
ANTHROPIC_AUTH_TOKEN=your_minimax_api_key_here
# 海外用户使用 api.minimax.io，国内用户可改为 api.minimaxi.com
ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7
API_TIMEOUT_MS=3000000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

> **获取 API Key**：访问 [MiniMax 开放平台](https://platform.minimax.io) 注册并获取 API Key。

---

## 方式三：其他代理工具

社区还有一些专门为 Claude Code 做的代理工具：

| 工具 | 说明 | 链接 |
|------|------|------|
| **a2o** | Anthropic → OpenAI 单二进制文件，零依赖 | [Twitter](https://x.com/mantou543/status/2018846154855940200) |
| **Empero Proxy** | 完整的 Anthropic Messages API 转 OpenAI 代理 | [Twitter](https://x.com/EmperoAI/status/2036840854065762551) |
| **Alma** | 内置 OpenAI → Anthropic 转换代理的客户端 | [Twitter](https://x.com/yetone/status/2003508782127833332) |
| **Chutes** | Docker 容器，支持 60+ 开源模型 | [Twitter](https://x.com/chutes_ai/status/2027039742915662232) |

---

## 注意事项与已知限制

### 1. `drop_params: true` 很重要

本项目会发送 Anthropic 专有参数（如 `thinking`、`cache_control`），这些参数在 OpenAI API 中不存在。LiteLLM 配置中必须设置 `drop_params: true`，否则请求会报错。

### 2. Extended Thinking 不可用

Anthropic 的 Extended Thinking 功能是专有特性，其他模型不支持。使用第三方模型时此功能自动失效。

### 3. Prompt Caching 不可用

`cache_control` 是 Anthropic 专有功能。使用第三方模型时，prompt caching 不会生效（但不会导致报错，会被 `drop_params` 忽略）。

### 4. 工具调用兼容性

本项目大量使用工具调用（tool_use），LiteLLM 会自动转换 Anthropic tool_use 格式到 OpenAI function_calling 格式。大部分情况下可以正常工作，但某些复杂工具调用可能存在兼容性问题。如遇问题，建议使用能力较强的模型（如 GPT-4o）。

### 5. 遥测和非必要网络请求

建议配置以下环境变量以避免不必要的网络请求：
```
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### 6. DeepSeek `max_tokens` 上限（重要）

DeepSeek 的 Anthropic 兼容端点（`https://api.deepseek.com/anthropic`）对 `max_tokens` 有上限，且**不同模型差别很大**：

| 模型 | 最大 `max_tokens` | 备注 |
|------|------------------|------|
| `deepseek-chat`（V4 系，含 V4-flash / V4-pro） | **384,000** | Claude Code 默认 200,000 不会超限 |
| `deepseek-reasoner`（旧 R1，含 thinking） | **64,000**（默认 32,000） | `max_tokens` **包含** thinking tokens；超限直接返回 HTTP 400 |
| 兼容层旧版本 | 8,192 | 历史限制；如果你接的是其他自称 DeepSeek 兼容的代理，可能仍是 8K |

**症状**：接入一段时间后突然返回 `400 Bad Request`，错误体里通常包含 `max_tokens` / `tokens exceeded` 字样 — 几乎都是命中了上面的上限（特别是 `deepseek-reasoner` 在长 thinking 之后）。

**对应做法**：

- 优先用 `deepseek-chat`（V4 系），上限充裕
- 如果一定要用 `deepseek-reasoner`：在你的客户端 / 中间代理把 `max_tokens` 降到 ≤ 60,000，并预留几千给 thinking
- 接到老的"DeepSeek 兼容代理"（非官方）报 `max_tokens must be <= 8192` 时，直接换上游

> 上游官方文档：[DeepSeek Pricing & Limits](https://api-docs.deepseek.com/quick_start/pricing)

### 7. 本地模型（Ollama / LMStudio）工具调用与多轮上下文（重要）

接入 Ollama / LMStudio 等本地推理服务时，多轮工具调用 + 推理（thinking）场景常见症状：
- 第 2 轮起模型「忘记」前面工具的执行结果
- 工具被反复调用、陷入死循环
- 流式响应中工具调用整体被吞没（无 `tool_use` block）
- 报 `tool_use_id` 找不到对应 `tool_use`

这些通常来自**上游侧**的三个限制，光改 proxy 解决不了，必须配合本节配置：

#### 7.1 `num_ctx` 必须 ≥ 32768（关键）

Ollama 默认 `num_ctx=12288`（12K），但 Claude Code 的 system prompt + 工具定义本身就 30K+。**默认配置下工具定义会被 Ollama 静默截断**，模型根本看不到可调用的工具，于是要么乱调要么不调。

```bash
# Ollama: 创建持久化 Modelfile
cat > Modelfile <<EOF
FROM gemma3:12b
PARAMETER num_ctx 32768
EOF
ollama create gemma3-32k -f Modelfile

# 或临时覆盖（每次请求生效）
curl http://localhost:11434/api/chat -d '{
  "model": "gemma3:12b",
  "options": {"num_ctx": 32768},
  ...
}'
```

LMStudio：在「Server」→「Model Settings」中显式把 Context Length 拉到 32K+。

#### 7.2 模型选择：避开 Gemma 3 / Gemma 4 工具调用

Gemma 3 / 4 系列**工具调用训练数据稀缺**，多轮 tool_use 场景下表现极不稳定（已知 Ollama 上游 issue [#9680](https://github.com/ollama/ollama/issues/9680) / [#15241](https://github.com/ollama/ollama/issues/15241)）。即便配置完美，仍会出现：
- 工具参数 JSON 格式错误
- 调用了不存在的工具
- 多轮后完全停止调用工具

**推荐替代**（按工具调用质量排序）：
1. `qwen2.5-coder:14b` / `qwen2.5-coder:32b` — 工具调用最稳定
2. `llama3.1:8b` / `llama3.1:70b` — 通用，工具调用可靠
3. `qwen3:14b` — 新模型，工具调用质量在改进中

#### 7.3 工具调用流式异常时禁用 streaming

部分 Ollama 版本在 `stream: true` + `tools` 同时启用时，会出现：
- `[DONE]` 标记缺失，客户端永久等待
- tool_call 分片不完整
- 工具参数 JSON 截断

**对应做法**：在 Claude Code 侧没法直接关 streaming，但可以在 LiteLLM / 中间代理里把目标 model 的 `stream` 强制设为 `false`：

```yaml
# LiteLLM config.yaml
model_list:
  - model_name: gemma-local
    litellm_params:
      model: ollama/gemma3:12b
      api_base: http://localhost:11434
      stream: false   # 关键：本地模型 + tools 时关掉
```

> 本项目 proxy 已对上游响应做了修复（#195）：
> - 上游不返回 `tool_call.id` 时合成稳定 fallback id（防止下一轮 tool_result 配对失败）
> - 助手消息中的 thinking 内容会以 `<thinking>...</thinking>` 形式保留进下一轮 prompt（防止多轮推理上下文丢失）
>
> 但**第 7.1 / 7.2 / 7.3 是上游限制，必须在 Ollama / LMStudio 侧配置**。

### 8. 阿里 DashScope / Qwen 接入常见问题（重要）

接入阿里云 Qwen / DashScope 时，401、403、`找不到该大模型` 等错误几乎都来自下面四类配置混淆。

#### 8.1 选对端点：Anthropic-compat vs OpenAI-compat

DashScope 同时提供两种协议端点，**它们用的 Key 不一样、走的协议也不一样**：

| 端点 | 协议 | 适用 Key | 用法 |
|---|---|---|---|
| `https://coding.dashscope.aliyuncs.com/apps/anthropic` | **Anthropic** | Coding Plan key（`sk-` 开头，控制台「百炼 / Coding Plan」开通） | 直连本项目，**无需 LiteLLM** |
| `https://dashscope.aliyuncs.com/compatible-mode/v1`（国内） | OpenAI | 普通 DashScope key（`sk-` 开头） | 必须经 LiteLLM 协议转换 |
| `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`（国际） | OpenAI | 国际版 DashScope key | 必须经 LiteLLM 协议转换 |

**两种 Key 不可互换**：Coding Plan key 不能用于 OpenAI-compat 端点；普通 DashScope key 也不能用于 Anthropic-compat 端点。错配会直接 401。

#### 8.2 只用一种认证变量（避免 Auth conflict）

`ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN` **同时设置**时，Anthropic SDK 会同时发送 `x-api-key` 和 `Authorization: Bearer` 两个头。DashScope 严格校验，会直接拒绝。

**强制要求**：接入 DashScope 时**只保留 `ANTHROPIC_AUTH_TOKEN`**，把 `ANTHROPIC_API_KEY` 从下列**所有位置**清除：

- `.env`
- 当前 shell 的环境变量（`unset ANTHROPIC_API_KEY` / Windows `Remove-Item Env:\ANTHROPIC_API_KEY`）
- `~/.claude/settings.json` 的 `env` 字段
- 系统级配置（`~/.bashrc` / `~/.zshrc` / Windows 系统环境变量）

**自检命令**：

```bash
# macOS / Linux
env | grep -i anthropic
# Windows PowerShell
Get-ChildItem Env:ANTHROPIC*
```

输出里**只能看到** `ANTHROPIC_AUTH_TOKEN` 和 `ANTHROPIC_BASE_URL` 等，**不能出现** `ANTHROPIC_API_KEY`。

#### 8.3 model 名要写官方 ID

`ANTHROPIC_MODEL` 必须写 DashScope **官方模型 ID**，不能用别名：

✅ 正确：`qwen3-coder-plus` / `qwen3-coder` / `qwen-max` / `qwen-plus` / `qwen-turbo`
❌ 错误：`qwen` / `qwen3` / `coder` / `claude-3-sonnet`（错配会返回 `找不到该大模型`）

完整模型列表见阿里云控制台「百炼」→「模型广场」。

#### 8.4 走 OpenAI-compat 端点时必须用 LiteLLM

如果你**不是** Coding Plan 用户，只有普通 DashScope key，那只能走 OpenAI-compat 端点，**必须**走 LiteLLM 协议转换：

```yaml
# litellm_config.yaml
model_list:
  - model_name: qwen-plus
    litellm_params:
      model: openai/qwen-plus
      api_key: os.environ/DASHSCOPE_API_KEY
      api_base: https://dashscope.aliyuncs.com/compatible-mode/v1

litellm_settings:
  drop_params: true
```

然后按本文 [§方式一](#方式一-litellm-代理推荐) 启动 LiteLLM 并把 `ANTHROPIC_BASE_URL` 指向 `http://localhost:4000`。

#### 8.5 LongCat / 其他「Anthropic 兼容」第三方端点

社区还有 LongCat (`https://api.longcat.chat/anthropic`) 等同样宣称兼容 Anthropic 协议的端点。它们的常见坑跟 DashScope Coding Plan 一致：

- 必须用 `ANTHROPIC_AUTH_TOKEN`，**不能**同时设 `ANTHROPIC_API_KEY`
- model 名要用各自平台的官方 ID
- 没有官方报错时，先按上面 §8.2 自检环境变量是否冲突

---

## FAQ

### Q: LiteLLM 代理报错 `/v1/responses` 找不到？

部分 OpenAI 兼容服务只支持 `/v1/chat/completions`。在 LiteLLM 配置中添加：

```yaml
litellm_settings:
  use_chat_completions_url_for_anthropic_messages: true
```

### Q: `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN` 有什么区别？

- `ANTHROPIC_API_KEY` → 通过 `x-api-key` 请求头发送
- `ANTHROPIC_AUTH_TOKEN` → 通过 `Authorization: Bearer` 请求头发送

LiteLLM 代理默认接受 Bearer Token 格式，建议使用 `ANTHROPIC_AUTH_TOKEN`。

### Q: 可以同时配置多个模型吗？

可以。在 `litellm_config.yaml` 中配置多个 `model_name`，然后通过修改 `ANTHROPIC_MODEL` 切换。

### Q: 本地 Ollama 模型效果不好怎么办？

本项目的系统提示和工具调用对模型能力要求较高。建议使用参数量较大的模型（如 Llama 3 70B+, Qwen 72B+），小模型可能无法正确处理工具调用。

### Q: 接入 DeepSeek 一段时间后突然 HTTP 400？

绝大多数情况是命中了 `max_tokens` 上限。详见上文 [《DeepSeek max_tokens 上限》](#_6-deepseek-max-tokens-上限重要)。最快的排查办法：把模型从 `deepseek-reasoner` 换成 `deepseek-chat` 重试；如果不再 400，就是 reasoner 的 64K 上限触发。
