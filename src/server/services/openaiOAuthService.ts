/**
 * OpenAIOAuthService — 桌面端 / 服务端进程持有 ChatGPT 订阅 OAuth token 的封装。
 *
 * 设计要点：
 * - token 落盘在 ~/.claude/cc-haha/openai-oauth.json（mode 0o600），与 Anthropic OAuth 完全隔离。
 * - sessions 在内存中维护（PKCE state + verifier），TTL 5 分钟。
 * - ensureFreshTokens() 自动刷新 access_token，调用方拿到的就是可直接用的 token。
 *
 * ⚠️ 该 service 持有的 token 用于调用 https://chatgpt.com/backend-api/codex/responses，
 *    使用范围仅限于个人订阅自助开发场景，不适合大规模部署。
 */

import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  buildAuthUrl,
  isTokenExpired,
  refreshAccessToken,
  exchangeCodeForTokens,
} from '../../services/openai-oauth/client.js'
import {
  OPENAI_OAUTH_FILE_RELATIVE_PATH,
} from '../../services/openai-oauth/constants.js'
import type {
  OpenAIOAuthSession,
  OpenAIOAuthTokens,
} from '../../services/openai-oauth/types.js'

const SESSION_TTL_MS = 5 * 60 * 1000

export class OpenAIOAuthService {
  private sessions = new Map<string, OpenAIOAuthSession>()

  private getOAuthFilePath(): string {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    return path.join(configDir, OPENAI_OAUTH_FILE_RELATIVE_PATH)
  }

  startSession(): { authorizeUrl: string; state: string } {
    this.purgeExpiredSessions()
    const { authorizeUrl, state, codeVerifier } = buildAuthUrl()
    this.sessions.set(state, {
      state,
      codeVerifier,
      authorizeUrl,
      createdAt: Date.now(),
    })
    return { authorizeUrl, state }
  }

  async completeSession(code: string, state: string): Promise<OpenAIOAuthTokens> {
    this.purgeExpiredSessions()
    const session = this.sessions.get(state)
    if (!session) {
      throw new Error('OAuth session not found or expired. Restart login.')
    }
    this.sessions.delete(state)

    const tokens = await exchangeCodeForTokens(code, session.codeVerifier)
    await this.saveTokens(tokens)
    return tokens
  }

  async loadTokens(): Promise<OpenAIOAuthTokens | null> {
    try {
      const raw = await fs.readFile(this.getOAuthFilePath(), 'utf-8')
      return JSON.parse(raw) as OpenAIOAuthTokens
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async saveTokens(tokens: OpenAIOAuthTokens): Promise<void> {
    const filePath = this.getOAuthFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 })
    await fs.rename(tmp, filePath)
  }

  async deleteTokens(): Promise<void> {
    try {
      await fs.unlink(this.getOAuthFilePath())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  /**
   * 获取最新有效 token。如果即将过期，自动 refresh 并落盘。
   * 没登录或 refresh 失败时返回 null（调用方应当返回 401 / 提示登录）。
   */
  async ensureFreshTokens(): Promise<OpenAIOAuthTokens | null> {
    const tokens = await this.loadTokens()
    if (!tokens) return null

    if (!isTokenExpired(tokens.expiresAt)) return tokens

    if (!tokens.refreshToken) {
      // 没有 refresh_token 又过期，无法续期
      return null
    }

    try {
      const refreshed = await refreshAccessToken(tokens.refreshToken)
      // refresh 接口可能不返回 chatgpt_account_id，则保留旧值
      const merged: OpenAIOAuthTokens = {
        ...refreshed,
        chatgptAccountId:
          refreshed.chatgptAccountId ?? tokens.chatgptAccountId,
        email: refreshed.email ?? tokens.email,
      }
      await this.saveTokens(merged)
      return merged
    } catch {
      return null
    }
  }

  private purgeExpiredSessions(): void {
    const now = Date.now()
    for (const [state, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(state)
      }
    }
  }
}

export const openaiOAuthService = new OpenAIOAuthService()
