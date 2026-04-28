import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { getUserSpecifiedModelSetting } from '../model/model.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalAnthropicModel: string | undefined
let originalAnthropicSmallFast: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cc-haha-model-priority-'))

  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir

  originalAnthropicModel = process.env.ANTHROPIC_MODEL
  delete process.env.ANTHROPIC_MODEL

  // ANTHROPIC_SMALL_FAST_MODEL is unrelated but lives next door; leave alone.
  originalAnthropicSmallFast = process.env.ANTHROPIC_SMALL_FAST_MODEL

  resetSettingsCache()
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  if (originalAnthropicModel !== undefined) {
    process.env.ANTHROPIC_MODEL = originalAnthropicModel
  } else {
    delete process.env.ANTHROPIC_MODEL
  }
  if (originalAnthropicSmallFast !== undefined) {
    process.env.ANTHROPIC_SMALL_FAST_MODEL = originalAnthropicSmallFast
  } else {
    delete process.env.ANTHROPIC_SMALL_FAST_MODEL
  }
  resetSettingsCache()
  await rm(tmpDir, { recursive: true, force: true })
})

describe('updateSettingsForSource — /model persistence (P0-1)', () => {
  test('writes the chosen model to ~/.claude/settings.json', async () => {
    const result = updateSettingsForSource('userSettings', {
      model: 'sonnet',
    })

    expect(result.error).toBeNull()

    const raw = await readFile(join(tmpDir, 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as { model?: string }
    expect(parsed.model).toBe('sonnet')
  })

  test('passing model: undefined deletes the key (resets to default)', async () => {
    updateSettingsForSource('userSettings', { model: 'sonnet' })
    resetSettingsCache()

    const result = updateSettingsForSource('userSettings', {
      model: undefined,
    })
    expect(result.error).toBeNull()

    const raw = await readFile(join(tmpDir, 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as { model?: string }
    expect(parsed.model).toBeUndefined()
  })

  test('overwriting model preserves other settings keys (deep merge)', async () => {
    updateSettingsForSource('userSettings', {
      model: 'sonnet',
      includeCoAuthoredBy: true,
    })
    resetSettingsCache()

    updateSettingsForSource('userSettings', { model: 'opus' })

    const stored = getSettingsForSource('userSettings')
    expect(stored?.model).toBe('opus')
    expect(stored?.includeCoAuthoredBy).toBe(true)
  })
})

describe('getUserSpecifiedModelSetting — priority order (P0-1)', () => {
  test('settings.model wins over ANTHROPIC_MODEL env', () => {
    updateSettingsForSource('userSettings', { model: 'sonnet' })
    resetSettingsCache()
    process.env.ANTHROPIC_MODEL = 'opus'

    expect(getUserSpecifiedModelSetting()).toBe('sonnet')
  })

  test('ANTHROPIC_MODEL env is used when settings.model is absent', () => {
    process.env.ANTHROPIC_MODEL = 'opus'

    expect(getUserSpecifiedModelSetting()).toBe('opus')
  })

  test('returns undefined when neither settings.model nor env is set', () => {
    expect(getUserSpecifiedModelSetting()).toBeUndefined()
  })
})
