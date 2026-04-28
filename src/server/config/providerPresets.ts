// Provider presets inspired by cc-switch (https://github.com/farion1231/cc-switch)
// Original work by Jason Young, MIT License

import { z } from 'zod'

import providerPresetsJson from './providerPresets.json'
import { ApiFormatSchema, AuthModeSchema } from '../types/provider.js'

const ModelMappingSchema = z.object({
  main: z.string(),
  haiku: z.string(),
  sonnet: z.string(),
  opus: z.string(),
})

/**
 * One selectable entry in a preset's model dropdown.
 *
 * `id` is the canonical identifier used everywhere a user-facing model selection
 * is stored (UI state, ANTHROPIC_MODEL env var, SavedProvider.models). The proxy
 * receives this value as `body.model` from claude-code.
 *
 * `apiModel` is what the proxy actually puts on the wire when forwarding to the
 * upstream provider. For "Fast" variants `id` and `apiModel` differ:
 * `id="gpt-5.5-fast"`, `apiModel="gpt-5.5"`. The "Fast" semantic is realized via
 * `requestOverrides`, e.g. `{ reasoning: { effort: "low" } }`, which the proxy
 * deep-merges into the transformed upstream request.
 *
 * Mirrors the design used by sst/opencode (see provider/provider.ts:1021-1043
 * and provider/sdk/.../openai-responses-language-model.ts:295-305) where the
 * UI variant id and the wire `model` field are intentionally decoupled.
 */
const AvailableModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  apiModel: z.string().min(1),
  requestOverrides: z.record(z.string(), z.unknown()).optional(),
})

const ProviderPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema,
  authMode: AuthModeSchema,
  defaultModels: ModelMappingSchema,
  /** Optional curated dropdown of selectable models. When absent, UI falls back to free-text inputs. */
  availableModels: z.array(AvailableModelSchema).optional(),
  needsApiKey: z.boolean(),
  websiteUrl: z.string(),
})

const ProviderPresetsSchema = z.array(ProviderPresetSchema)

export type ModelMapping = z.infer<typeof ModelMappingSchema>
export type AvailableModel = z.infer<typeof AvailableModelSchema>
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>

export const PROVIDER_PRESETS = ProviderPresetsSchema.parse(providerPresetsJson)
