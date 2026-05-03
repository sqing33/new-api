export interface ModelOption {
  label: string
  value: string
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export interface ImageGenerationRequest {
  model: string
  group?: string
  prompt: string
  n: number
  size: string
  quality?: string
  style?: string
  response_format: 'url' | 'b64_json'
}

export interface ImageResult {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

export interface ImageGenerationResponse {
  created?: number
  data?: ImageResult[]
}
