/**
 * Proxy Handler — protocol-translating reverse proxy for OpenAI-compatible APIs.
 *
 * Receives Anthropic Messages API requests from the CLI, transforms them to
 * OpenAI Chat Completions or Responses API format, forwards to the upstream
 * provider, and transforms the response back to Anthropic format.
 *
 * Derived from cc-switch (https://github.com/farion1231/cc-switch)
 * Original work by Jason Young, MIT License
 */

import { randomUUID } from 'crypto'
import { ProviderService } from '../services/providerService.js'
import { openaiOAuthService } from '../services/openaiOAuthService.js'
import {
  CODEX_BASE_URL,
  CODEX_HEADER_VALUES,
  CODEX_HEADERS,
  CODEX_RESPONSES_PATH,
} from '../../services/openai-oauth/constants.js'
import { anthropicToOpenaiChat } from './transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from './transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from './transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from './transform/openaiResponsesToAnthropic.js'
import { openaiChatStreamToAnthropic } from './streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from './streaming/openaiResponsesStreamToAnthropic.js'
import type { AnthropicRequest } from './transform/types.js'
import { PROVIDER_PRESETS, type AvailableModel } from '../config/providerPresets.js'

const providerService = new ProviderService()

/**
 * Look up a Fast/variant model entry in the ChatGPT preset's availableModels.
 * Returns `null` when the model id is not a curated entry (user-defined custom
 * id) — caller should leave the request unmodified in that case.
 */
function findChatgptAvailableModel(modelId: string): AvailableModel | null {
  const preset = PROVIDER_PRESETS.find((p) => p.id === 'chatgpt')
  if (!preset?.availableModels) return null
  return preset.availableModels.find((m) => m.id === modelId) ?? null
}

/**
 * Recursively merge `overrides` into `target`. Plain-object values are merged;
 * everything else (primitives, arrays, null) replaces wholesale. Used so a Fast
 * variant's `{ reasoning: { effort: 'low' } }` does not blow away unrelated keys
 * the upstream transform may have set on `transformed.reasoning`.
 */
function deepMergeOverrides(
  target: Record<string, unknown>,
  overrides: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(overrides)) {
    const existing = target[key]
    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
    if (isPlainObject(existing) && isPlainObject(value)) {
      deepMergeOverrides(existing, value)
    } else {
      target[key] = value
    }
  }
}

export async function handleProxyRequest(req: Request, url: URL): Promise<Response> {
  const providerMatch = url.pathname.match(/^\/proxy\/providers\/([^/]+)\/v1\/messages$/)
  const providerId = providerMatch ? decodeURIComponent(providerMatch[1]!) : undefined
  const isActiveProxyPath = url.pathname === '/proxy/v1/messages'

  // Only handle POST /proxy/v1/messages or POST /proxy/providers/:providerId/v1/messages
  if (req.method !== 'POST' || (!isActiveProxyPath && !providerMatch)) {
    return Response.json(
      {
        error: 'Not Found',
        message: 'Proxy only handles POST /proxy/v1/messages and POST /proxy/providers/:providerId/v1/messages',
      },
      { status: 404 },
    )
  }

  // Read active/default provider config or an explicitly-scoped provider config.
  const config = await providerService.getProviderForProxy(providerId)
  if (!config) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: providerId
            ? `Provider "${providerId}" is not configured for proxy`
            : 'No active provider configured for proxy',
        },
      },
      { status: 400 },
    )
  }

  if (config.apiFormat === 'anthropic') {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: providerId
            ? `Provider "${providerId}" uses anthropic format — proxy not needed`
            : 'Active provider uses anthropic format — proxy not needed',
        },
      },
      { status: 400 },
    )
  }

  // Parse request body
  let body: AnthropicRequest
  try {
    body = (await req.json()) as AnthropicRequest
  } catch {
    return Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON in request body' } },
      { status: 400 },
    )
  }

  const isStream = body.stream === true
  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  try {
    // ChatGPT 订阅 OAuth：单独走 codex/responses，不复用 platform.openai.com 路径
    if (config.authMode === 'oauth_chatgpt') {
      return await handleChatgptOAuth(body, isStream)
    }
    if (config.apiFormat === 'openai_chat') {
      return await handleOpenaiChat(body, baseUrl, config.apiKey, isStream)
    } else {
      return await handleOpenaiResponses(body, baseUrl, config.apiKey, isStream)
    }
  } catch (err) {
    console.error('[Proxy] Upstream request failed:', err)
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 502 },
    )
  }
}

async function handleOpenaiChat(
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
): Promise<Response> {
  const transformed = anthropicToOpenaiChat(body)
  const url = `${baseUrl}/v1/chat/completions`

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(transformed),
    signal: isStream ? AbortSignal.timeout(30_000) : AbortSignal.timeout(300_000),
  })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Upstream returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        { status: 502 },
      )
    }
    const anthropicStream = openaiChatStreamToAnthropic(upstream.body, body.model)
    return new Response(anthropicStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // Non-streaming
  const responseBody = await upstream.json()
  const anthropicResponse = openaiChatToAnthropic(responseBody, body.model)
  return Response.json(anthropicResponse)
}

async function handleOpenaiResponses(
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
): Promise<Response> {
  const transformed = anthropicToOpenaiResponses(body)
  const url = `${baseUrl}/v1/responses`

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(transformed),
    signal: isStream ? AbortSignal.timeout(30_000) : AbortSignal.timeout(300_000),
  })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Upstream returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        { status: 502 },
      )
    }
    const anthropicStream = openaiResponsesStreamToAnthropic(upstream.body, body.model)
    return new Response(anthropicStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // Non-streaming
  const responseBody = await upstream.json()
  const anthropicResponse = openaiResponsesToAnthropic(responseBody, body.model)
  return Response.json(anthropicResponse)
}

/**
 * ChatGPT 订阅模式：用 OAuth token 调用 https://chatgpt.com/backend-api/codex/responses。
 *
 * 与 platform.openai.com 的 /v1/responses 协议结构基本一致，差别在于：
 *  - URL 是 /codex/responses
 *  - 必须带 OpenAI-Beta: responses=experimental
 *  - 必须带 chatgpt-account-id（来自 access_token JWT 的 chatgpt_account_id claim）
 *  - 必须带 originator: codex_cli_rs（通过 originator 鉴别为合法 Codex 客户端调用）
 *  - 推荐带 session_id / conversation_id（uuid，用于 chatgpt 端的会话归集）
 */
async function handleChatgptOAuth(
  body: AnthropicRequest,
  isStream: boolean,
): Promise<Response> {
  const tokens = await openaiOAuthService.ensureFreshTokens()
  if (!tokens) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message:
            'ChatGPT subscription not logged in. Run `bun run scripts/openai-login.ts` or POST /api/openai-oauth/start.',
        },
      },
      { status: 401 },
    )
  }
  if (!tokens.chatgptAccountId) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message:
            'OAuth token missing chatgpt_account_id claim. Re-run login.',
        },
      },
      { status: 401 },
    )
  }

  const transformed = anthropicToOpenaiResponses(body)

  // Apply ChatGPT preset variant rewriting: when body.model matches a curated
  // availableModels entry whose `apiModel` differs from `id` (e.g. the "Fast"
  // variants share the base wire model id), rewrite the wire `model` and merge
  // any per-variant requestOverrides (e.g. `reasoning.effort=low` for Fast).
  // See providerPresets.json -> chatgpt.availableModels.
  const variantEntry = findChatgptAvailableModel(body.model)
  if (variantEntry) {
    if (variantEntry.apiModel !== variantEntry.id) {
      transformed.model = variantEntry.apiModel
    }
    if (variantEntry.requestOverrides) {
      deepMergeOverrides(
        transformed as unknown as Record<string, unknown>,
        variantEntry.requestOverrides,
      )
    }
  }

  const url = `${CODEX_BASE_URL}${CODEX_RESPONSES_PATH}`

  const sessionId = randomUUID()
  const conversationId = randomUUID()

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      [CODEX_HEADERS.BETA]: CODEX_HEADER_VALUES.BETA_RESPONSES,
      [CODEX_HEADERS.ACCOUNT_ID]: tokens.chatgptAccountId,
      [CODEX_HEADERS.ORIGINATOR]: CODEX_HEADER_VALUES.ORIGINATOR,
      [CODEX_HEADERS.SESSION_ID]: sessionId,
      [CODEX_HEADERS.CONVERSATION_ID]: conversationId,
    },
    body: JSON.stringify(transformed),
    signal: isStream ? AbortSignal.timeout(30_000) : AbortSignal.timeout(300_000),
  })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `ChatGPT upstream HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'ChatGPT upstream returned no body for stream' } },
        { status: 502 },
      )
    }
    const anthropicStream = openaiResponsesStreamToAnthropic(upstream.body, body.model)
    return new Response(anthropicStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  const responseBody = await upstream.json()
  const anthropicResponse = openaiResponsesToAnthropic(responseBody, body.model)
  return Response.json(anthropicResponse)
}
