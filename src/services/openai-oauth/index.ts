/**
 * OpenAI OAuth 服务 (ChatGPT 订阅登录) — 协调 PKCE 流程。
 *
 * 与 src/services/oauth (Anthropic OAuth) 完全独立：不同的 client_id、
 * 不同的 token endpoint、不同的 token 落盘位置。
 */

import { AuthCodeListener } from '../oauth/auth-code-listener.js'
import { openBrowser } from '../../utils/browser.js'
import {
  OPENAI_OAUTH_CALLBACK_PATH,
  OPENAI_OAUTH_PORT,
} from './constants.js'
import {
  buildAuthUrl,
  exchangeCodeForTokens,
} from './client.js'
import type { OpenAIOAuthTokens } from './types.js'

export class OpenAIOAuthService {
  private codeVerifier: string | null = null
  private state: string | null = null
  private listener: AuthCodeListener | null = null

  async startOAuthFlow(options?: {
    skipBrowserOpen?: boolean
    onAuthorizeUrl?: (url: string) => Promise<void>
  }): Promise<OpenAIOAuthTokens> {
    this.listener = new AuthCodeListener(OPENAI_OAUTH_CALLBACK_PATH)
    await this.listener.start(OPENAI_OAUTH_PORT)

    const { authorizeUrl, state, codeVerifier } = buildAuthUrl()
    this.codeVerifier = codeVerifier
    this.state = state

    try {
      const code = await this.listener.waitForAuthorization(state, async () => {
        if (options?.onAuthorizeUrl) {
          await options.onAuthorizeUrl(authorizeUrl)
        }
        if (!options?.skipBrowserOpen) {
          await openBrowser(authorizeUrl)
        }
      })

      const tokens = await exchangeCodeForTokens(code, codeVerifier)
      return tokens
    } finally {
      this.cleanup()
    }
  }

  cleanup(): void {
    this.listener?.close()
    this.listener = null
    this.codeVerifier = null
    this.state = null
  }
}
