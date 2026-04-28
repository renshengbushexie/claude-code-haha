/**
 * OpenAI OAuth (ChatGPT 订阅登录) 常量
 *
 * 这些值与 OpenAI 官方 Codex CLI 一致。
 * 参考实现：
 *   - numman-ali/opencode-openai-codex-auth
 *   - EvanZhouDev/openai-oauth
 *
 * ⚠️ ToS 提示：通过该 client_id 调用 chatgpt.com 内部接口处于 OpenAI 服务条款的灰色地带，
 *   仅用于个人订阅范围内的开发自助使用。请勿用于商业转售、多租户分发或大规模自动化。
 */

export const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

export const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
export const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'

/**
 * 必须使用 1455 端口（与 Codex CLI 注册的 redirect_uri 一致），不能动态分配端口。
 */
export const OPENAI_OAUTH_PORT = 1455
export const OPENAI_OAUTH_CALLBACK_PATH = '/auth/callback'
export const OPENAI_OAUTH_REDIRECT_URI = `http://localhost:${OPENAI_OAUTH_PORT}${OPENAI_OAUTH_CALLBACK_PATH}`

export const OPENAI_OAUTH_SCOPE = 'openid profile email offline_access'

/**
 * ChatGPT 订阅模型的入口（Codex backend）。
 * 与 platform.openai.com 的 /v1/responses 不同，这里走 chatgpt.com 内部 API。
 */
export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
export const CODEX_RESPONSES_PATH = '/codex/responses'

/**
 * 注入到 chatgpt.com 上游请求的 header。
 */
export const CODEX_HEADERS = {
  BETA: 'OpenAI-Beta',
  ACCOUNT_ID: 'chatgpt-account-id',
  ORIGINATOR: 'originator',
  SESSION_ID: 'session_id',
  CONVERSATION_ID: 'conversation_id',
} as const

export const CODEX_HEADER_VALUES = {
  BETA_RESPONSES: 'responses=experimental',
  ORIGINATOR: 'codex_cli_rs',
} as const

/**
 * JWT 中包含 chatgpt_account_id 的 claim 路径。
 */
export const OPENAI_JWT_AUTH_CLAIM = 'https://api.openai.com/auth'

/**
 * Token 落盘路径（相对 ~/.claude/）。与 hahaOAuthService 隔离，避免覆盖 Anthropic OAuth。
 */
export const OPENAI_OAUTH_FILE_RELATIVE_PATH = 'cc-haha/openai-oauth.json'

/**
 * Provider 预置 ID。同时也是 /proxy/providers/:id/v1/messages 路由里的 id。
 */
export const OPENAI_OAUTH_PROVIDER_PRESET_ID = 'chatgpt'

/**
 * 默认模型 — ChatGPT 订阅当前可用的 Codex 系列模型。用户可在 UI / settings 中改写。
 */
export const DEFAULT_CHATGPT_MODELS = {
  main: 'gpt-5-codex',
  haiku: 'gpt-5-codex',
  sonnet: 'gpt-5-codex',
  opus: 'gpt-5-codex',
} as const
