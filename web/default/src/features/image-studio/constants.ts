import type { ImageGenerationRequest } from './types'

export const API_ENDPOINTS = {
  IMAGE_GENERATIONS: '/pg/images/generations',
  IMAGE_EDITS: '/pg/images/edits',
  USER_MODELS: '/api/user/models',
  USER_GROUPS: '/api/user/self/groups',
} as const

export const DEFAULT_GROUP = 'auto'

export const DEFAULT_CONFIG: ImageGenerationRequest = {
  model: 'gpt-image-1',
  group: DEFAULT_GROUP,
  prompt: '',
  n: 1,
  size: '1024x1024',
  quality: 'auto',
  style: 'vivid',
  response_format: 'b64_json',
}

export const IMAGE_SIZE_OPTIONS = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1024x1792',
  '1792x1024',
  '512x512',
  '256x256',
] as const

export const IMAGE_QUALITY_OPTIONS = [
  'auto',
  'standard',
  'hd',
  'low',
  'medium',
  'high',
] as const

export const IMAGE_STYLE_OPTIONS = ['vivid', 'natural'] as const
