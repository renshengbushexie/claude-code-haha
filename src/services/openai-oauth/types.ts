export type OpenAIOAuthTokens = {
  accessToken: string
  refreshToken: string | null
  /** 过期时刻 ms 时间戳。null 表示永不过期（极少出现，仅 fallback）。 */
  expiresAt: number | null
  /** 解析自 access_token JWT，用于 chatgpt-account-id header。 */
  chatgptAccountId: string | null
  /** id_token 中的 email（如果可用），仅做 UI 展示，不参与签名。 */
  email: string | null
  scopes: string[]
}

export type OpenAIOAuthTokenResponse = {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  scope?: string
  token_type?: string
}

export type OpenAIOAuthSession = {
  state: string
  codeVerifier: string
  authorizeUrl: string
  createdAt: number
}
