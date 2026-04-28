import type { ApiFormat } from './provider'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type AvailableModel = {
  id: string
  label: string
  apiModel: string
  requestOverrides?: Record<string, unknown>
}

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  defaultModels: ModelMapping
  availableModels?: AvailableModel[]
  needsApiKey: boolean
  websiteUrl: string
}
