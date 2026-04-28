/**
 * OpenAI (ChatGPT 订阅) OAuth REST API
 *
 * POST   /api/openai-oauth/start    生成 PKCE+state，返回 authorize URL（前端打开浏览器）
 * GET    /auth/callback             OAuth provider redirect 到此（必须 1455 端口，由 OpenAIOAuthService 监听）
 * GET    /api/openai-oauth/callback 兼容路径，处理 code+state 完成 token 交换
 * GET    /api/openai-oauth          查询登录状态（不回传 token 本体）
 * GET    /api/openai-oauth/status   同上
 * DELETE /api/openai-oauth          登出
 *
 * ⚠️ 注意：因为 redirect_uri 必须是 http://localhost:1455/auth/callback（与 Codex 注册的固定值一致），
 *   实际 callback 由 OpenAIOAuthService 内部启动的 1455 端口 listener 处理，
 *   这里的 /api/openai-oauth/callback 只是给手动粘贴 code 的兜底通道。
 */

import { z } from 'zod'
import { openaiOAuthService } from '../services/openaiOAuthService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

const StartRequestSchema = z.object({}).optional()

const CallbackRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function handleOpenAIOAuthApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2] // ['api', 'openai-oauth', <action?>]

    if (action === 'start' && req.method === 'POST') {
      // 允许空 body
      try {
        const text = await req.text()
        if (text) {
          const parsed = StartRequestSchema.safeParse(JSON.parse(text))
          if (!parsed.success) {
            throw ApiError.badRequest('Invalid body')
          }
        }
      } catch (err) {
        if (err instanceof ApiError) throw err
        // JSON parse error 视为 empty body
      }
      const { authorizeUrl, state } = openaiOAuthService.startSession()
      return Response.json({ authorizeUrl, state })
    }

    if (action === 'callback' && req.method === 'POST') {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        throw ApiError.badRequest('Invalid JSON body')
      }
      const parsed = CallbackRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw ApiError.badRequest('code and state are required')
      }
      const tokens = await openaiOAuthService.completeSession(
        parsed.data.code,
        parsed.data.state,
      )
      return Response.json({
        ok: true,
        email: tokens.email,
        chatgptAccountId: tokens.chatgptAccountId,
        expiresAt: tokens.expiresAt,
      })
    }

    if (action === 'callback' && req.method === 'GET') {
      // 兼容：浏览器误打到 :3456 的 /api/openai-oauth/callback。
      // 真正的 redirect_uri 是 :1455/auth/callback。
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) {
        return html(renderCallbackPage(false, 'Missing code or state'))
      }
      try {
        await openaiOAuthService.completeSession(code, state)
        return html(renderCallbackPage(true, null))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return html(renderCallbackPage(false, msg))
      }
    }

    if ((action === undefined || action === 'status') && req.method === 'GET') {
      const tokens = await openaiOAuthService.ensureFreshTokens()
      if (!tokens) return Response.json({ loggedIn: false })
      return Response.json({
        loggedIn: true,
        email: tokens.email,
        chatgptAccountId: tokens.chatgptAccountId,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      })
    }

    if (action === undefined && req.method === 'DELETE') {
      await openaiOAuthService.deleteTokens()
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}

function renderCallbackPage(success: boolean, errorMsg: string | null): string {
  if (success) {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>ChatGPT Login Success</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#333}.card{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.06)}h1{color:#16a34a;margin:0 0 12px}p{color:#666}</style>
</head><body><div class="card"><h1>✓ Login Successful</h1><p>You can close this window and return to Claude Code Haha.</p></div>
<script>setTimeout(()=>window.close(),1500)</script>
</body></html>`
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ChatGPT Login Failed</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#333}.card{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.06)}h1{color:#dc2626;margin:0 0 12px}pre{color:#666;white-space:pre-wrap;word-break:break-word;text-align:left;background:#f5f5f5;padding:12px;border-radius:6px}</style>
</head><body><div class="card"><h1>✗ Login Failed</h1><pre>${escapeHtml(errorMsg ?? 'Unknown error')}</pre></div>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
