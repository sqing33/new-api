import { api } from '@/lib/api'
import { API_ENDPOINTS } from './constants'
import type {
  GroupOption,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ModelOption,
} from './types'

export async function generateImage(
  payload: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const res = await api.post(API_ENDPOINTS.IMAGE_GENERATIONS, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

export async function editImage(
  payload: ImageGenerationRequest,
  image: File,
  mask?: File | null
): Promise<ImageGenerationResponse> {
  const formData = new FormData()
  formData.append('model', payload.model)
  if (payload.group) formData.append('group', payload.group)
  formData.append('prompt', payload.prompt)
  formData.append('n', String(payload.n))
  formData.append('size', payload.size)
  if (payload.quality) formData.append('quality', payload.quality)
  if (payload.style) formData.append('style', payload.style)
  formData.append('response_format', payload.response_format)
  formData.append('image', image)
  if (mask) formData.append('mask', mask)

  const res = await api.post(API_ENDPOINTS.IMAGE_EDITS, formData, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

export async function getUserModels(): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS)
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}
