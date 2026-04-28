#!/usr/bin/env bun
/**
 * ChatGPT 订阅 OAuth 登录脚本（命令行）
 *
 * 用法:
 *   bun run scripts/openai-login.ts            # 启动登录流程，自动打开浏览器
 *   bun run scripts/openai-login.ts --status   # 查看当前登录状态
 *   bun run scripts/openai-login.ts --logout   # 登出，删除 token
 *
 * 登录后 token 落盘在 ~/.claude/cc-haha/openai-oauth.json (mode 0o600)。
 *
 * ⚠️ 仅用于个人订阅自助开发场景。详见 .opencode/USAGE.md。
 */

import { OpenAIOAuthService } from '../src/services/openai-oauth/index.js'
import { openaiOAuthService } from '../src/server/services/openaiOAuthService.js'

const args = process.argv.slice(2)

async function main(): Promise<void> {
  if (args.includes('--logout')) {
    await openaiOAuthService.deleteTokens()
    console.log('✓ Logged out. Token file removed.')
    return
  }

  if (args.includes('--status')) {
    const tokens = await openaiOAuthService.ensureFreshTokens()
    if (!tokens) {
      console.log('Not logged in.')
      process.exit(1)
    }
    const expires =
      tokens.expiresAt != null
        ? new Date(tokens.expiresAt).toISOString()
        : 'never'
    console.log('✓ Logged in')
    console.log(`  email             : ${tokens.email ?? '(unknown)'}`)
    console.log(`  chatgptAccountId  : ${tokens.chatgptAccountId ?? '(missing!)'}`)
    console.log(`  expiresAt         : ${expires}`)
    console.log(`  scopes            : ${tokens.scopes.join(', ')}`)
    return
  }

  // Default: login flow
  console.log('Starting ChatGPT OAuth login...')
  console.log('A browser window will open. Sign in with your ChatGPT Plus / Pro account.')
  console.log('After approval the browser will redirect to http://localhost:1455/auth/callback')
  console.log()

  const service = new OpenAIOAuthService()
  try {
    const tokens = await service.startOAuthFlow({
      onAuthorizeUrl: async (url) => {
        console.log('If the browser does not open automatically, paste this URL:')
        console.log(`  ${url}`)
        console.log()
      },
    })
    await openaiOAuthService.saveTokens(tokens)
    console.log('✓ Login successful')
    console.log(`  email             : ${tokens.email ?? '(unknown)'}`)
    console.log(`  chatgptAccountId  : ${tokens.chatgptAccountId ?? '(missing!)'}`)
    if (!tokens.chatgptAccountId) {
      console.error()
      console.error('⚠️  Warning: access_token did not contain chatgpt_account_id claim.')
      console.error('   This means your account may not have an active ChatGPT subscription,')
      console.error('   or the OAuth client_id no longer maps to Codex.')
      process.exit(2)
    }
    const expires = tokens.expiresAt != null
      ? new Date(tokens.expiresAt).toISOString()
      : 'never'
    console.log(`  expiresAt         : ${expires}`)
  } catch (err) {
    console.error('✗ Login failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
