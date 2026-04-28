/**
 * OpenAI OAuth 客户端 — 走 auth.openai.com 的 PKCE 授权流程。
 *
 * 复用 src/services/oauth/crypto.ts 里的 PKCE 工具，避免重复实现。
 */

import axios from 'axios'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from '../oauth/crypto.js'
import {
  OPENAI_AUTHORIZE_URL,
  OPENAI_JWT_AUTH_CLAIM,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_REDIRECT_URI,
  OPENAI_OAUTH_SCOPE,
  OPENAI_TOKEN_URL,
} from './constants.js'
import type {
  OpenAIOAuthTokenResponse,
  OpenAIOAuthTokens,
} from './types.js'

export type BuildAuthUrlResult = {
  authorizeUrl: string
  state: string
  codeVerifier: string
}

export function buildAuthUrl(): BuildAuthUrlResult {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateState()

  const authUrl = new URL(OPENAI_AUTHORIZE_URL)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', OPENAI_OAUTH_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', OPENAI_OAUTH_REDIRECT_URI)
  authUrl.searchParams.set('scope', OPENAI_OAUTH_SCOPE)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return { authorizeUrl: authUrl.toString(), state, codeVerifier }
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  })

  const response = await axios.post<OpenAIOAuthTokenResponse>(
    OPENAI_TOKEN_URL,
    body.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      timeout: 15000,
    },
  )

  if (response.status !== 200) {
    throw new Error(
      `OpenAI token exchange failed (${response.status}): ${response.statusText}`,
    )
  }

  return formatTokens(response.data)
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OPENAI_OAUTH_CLIENT_ID,
    scope: OPENAI_OAUTH_SCOPE,
  })

  const response = await axios.post<OpenAIOAuthTokenResponse>(
    OPENAI_TOKEN_URL,
    body.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      timeout: 15000,
    },
  )

  if (response.status !== 200) {
    throw new Error(
      `OpenAI token refresh failed (${response.status}): ${response.statusText}`,
    )
  }

  const tokens = formatTokens(response.data)
  if (!tokens.refreshToken) {
    tokens.refreshToken = refreshToken
  }
  return tokens
}

export function isTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) return false
  const bufferMs = 5 * 60 * 1000
  return Date.now() + bufferMs >= expiresAt
}

function formatTokens(data: OpenAIOAuthTokenResponse): OpenAIOAuthTokens {
  const accessToken = data.access_token
  const expiresAt = Date.now() + (data.expires_in ?? 0) * 1000
  const scopes = (data.scope ?? '').split(' ').filter(Boolean)
  const chatgptAccountId = extractChatgptAccountId(accessToken)
  const email = extractEmail(data.id_token ?? null)

  return {
    accessToken,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    chatgptAccountId,
    email,
    scopes,
  }
}

/**
 * 从 access_token JWT 的 claims 中读取 chatgpt_account_id。
 * Codex backend 强制要求该 header，否则 401。
 */
export function extractChatgptAccountId(jwt: string): string | null {
  const payload = decodeJWTPayload(jwt)
  if (!payload) return null
  const auth = payload[OPENAI_JWT_AUTH_CLAIM] as
    | { chatgpt_account_id?: string }
    | undefined
  return auth?.chatgpt_account_id ?? null
}

function extractEmail(idToken: string | null): string | null {
  if (!idToken) return null
  const payload = decodeJWTPayload(idToken)
  return (payload?.email as string | undefined) ?? null
}

function decodeJWTPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.')
    if (parts.length < 2) return null
    const padded = parts[1]!
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(parts[1]!.length + ((4 - (parts[1]!.length % 4)) % 4), '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf-8')
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}
