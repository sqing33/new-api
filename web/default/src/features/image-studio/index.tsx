import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DownloadIcon,
  ImageIcon,
  Loader2Icon,
  SparklesIcon,
  WandSparklesIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ModelGroupSelector } from '@/components/model-group-selector'
import { editImage, generateImage, getUserGroups, getUserModels } from './api'
import {
  DEFAULT_CONFIG,
  DEFAULT_GROUP,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  IMAGE_STYLE_OPTIONS,
} from './constants'
import type {
  GroupOption,
  ImageGenerationRequest,
  ImageResult,
  ModelOption,
} from './types'

type Mode = 'generate' | 'edit'

const imageModelHints = [
  'image',
  'dall',
  'gpt-image',
  'imagen',
  'flux',
  'wan',
  'jimeng',
  'midjourney',
]

function resultSource(result: ImageResult) {
  if (result.url) return result.url
  if (result.b64_json) return `data:image/png;base64,${result.b64_json}`
  return ''
}

export function ImageStudio() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('generate')
  const [config, setConfig] = useState<ImageGenerationRequest>(DEFAULT_CONFIG)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [maskFile, setMaskFile] = useState<File | null>(null)
  const [results, setResults] = useState<ImageResult[]>([])
  const [isGenerating, setIsGenerating] = useState(false)

  const { data: modelsData = [], isLoading: isLoadingModels } = useQuery({
    queryKey: ['image-studio-models'],
    queryFn: getUserModels,
  })

  const { data: groupsData = [] } = useQuery({
    queryKey: ['image-studio-groups'],
    queryFn: getUserGroups,
  })

  const models = useMemo<ModelOption[]>(() => {
    const imageModels = modelsData.filter((model) =>
      imageModelHints.some((hint) => model.value.toLowerCase().includes(hint))
    )
    return imageModels.length > 0 ? imageModels : modelsData
  }, [modelsData])

  const groups = useMemo<GroupOption[]>(() => {
    const hasAutoGroup = groupsData.some(
      (group) => group.value === DEFAULT_GROUP
    )
    return hasAutoGroup
      ? groupsData
      : [
          {
            value: DEFAULT_GROUP,
            label: 'Auto',
            ratio: 1,
            desc: 'Circuit Breaker',
          },
          ...groupsData,
        ]
  }, [groupsData])

  useEffect(() => {
    if (models.length === 0) return
    const isCurrentModelValid = models.some(
      (model) => model.value === config.model
    )
    if (!isCurrentModelValid) {
      setConfig((current) => ({ ...current, model: models[0].value }))
    }
  }, [models, config.model])

  const updateConfig = <K extends keyof ImageGenerationRequest>(
    key: K,
    value: ImageGenerationRequest[K]
  ) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const handleGenerate = async () => {
    if (!config.prompt.trim()) {
      toast.error(t('Prompt is required'))
      return
    }
    if (mode === 'edit' && !imageFile) {
      toast.error(t('Image is required'))
      return
    }

    setIsGenerating(true)
    try {
      const response =
        mode === 'edit' && imageFile
          ? await editImage(config, imageFile, maskFile)
          : await generateImage(config)
      setResults(response.data ?? [])
      if (!response.data?.length) {
        toast.info(t('No image returned'))
      }
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { error?: { message?: string } } }
        message?: string
      }
      toast.error(
        err.response?.data?.error?.message || err.message || t('Request error')
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const downloadResult = (result: ImageResult, index: number) => {
    const href = resultSource(result)
    if (!href) return
    const link = document.createElement('a')
    link.href = href
    link.download = `image-studio-${index + 1}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold tracking-normal'>
          {t('Image Studio')}
        </h1>
        <p className='text-muted-foreground text-sm'>
          {t('Generate and edit images with your available New API models.')}
        </p>
      </div>

      <div className='grid min-h-0 flex-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]'>
        <Card className='h-fit rounded-lg'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <WandSparklesIcon className='size-4' />
              {t('Create')}
            </CardTitle>
            <CardDescription>
              {t('Use your account balance and group routing.')}
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-4'>
            <Tabs
              value={mode}
              onValueChange={(value) => setMode(value as Mode)}
            >
              <TabsList className='grid w-full grid-cols-2'>
                <TabsTrigger value='generate'>{t('Text to image')}</TabsTrigger>
                <TabsTrigger value='edit'>{t('Edit image')}</TabsTrigger>
              </TabsList>
              <TabsContent className='mt-4 grid gap-4' value='generate' />
              <TabsContent className='mt-4 grid gap-4' value='edit'>
                <div className='grid gap-2'>
                  <Label htmlFor='image-file'>{t('Source image')}</Label>
                  <Input
                    accept='image/png,image/jpeg,image/webp'
                    id='image-file'
                    onChange={(event) =>
                      setImageFile(event.target.files?.[0] ?? null)
                    }
                    type='file'
                  />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='mask-file'>{t('Mask')}</Label>
                  <Input
                    accept='image/png,image/jpeg,image/webp'
                    id='mask-file'
                    onChange={(event) =>
                      setMaskFile(event.target.files?.[0] ?? null)
                    }
                    type='file'
                  />
                </div>
              </TabsContent>
            </Tabs>

            <div className='grid gap-2'>
              <Label>{t('Model and group')}</Label>
              <ModelGroupSelector
                disabled={
                  isGenerating || isLoadingModels || models.length === 0
                }
                groups={groups}
                models={models}
                onGroupChange={(value) => updateConfig('group', value)}
                onModelChange={(value) => updateConfig('model', value)}
                selectedGroup={config.group ?? DEFAULT_GROUP}
                selectedModel={config.model}
              />
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='image-prompt'>{t('Prompt')}</Label>
              <Textarea
                className='min-h-32 resize-none'
                id='image-prompt'
                onChange={(event) => updateConfig('prompt', event.target.value)}
                placeholder={t('Describe the image you want to create')}
                value={config.prompt}
              />
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <div className='grid gap-2'>
                <Label>{t('Size')}</Label>
                <Select
                  value={config.size}
                  onValueChange={(value) => updateConfig('size', value)}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={size}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='grid gap-2'>
                <Label>{t('Images')}</Label>
                <Input
                  max={4}
                  min={1}
                  onChange={(event) =>
                    updateConfig('n', Number(event.target.value))
                  }
                  type='number'
                  value={config.n}
                />
              </div>
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <div className='grid gap-2'>
                <Label>{t('Quality')}</Label>
                <Select
                  value={config.quality}
                  onValueChange={(value) => updateConfig('quality', value)}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_QUALITY_OPTIONS.map((quality) => (
                      <SelectItem key={quality} value={quality}>
                        {quality}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='grid gap-2'>
                <Label>{t('Style')}</Label>
                <Select
                  value={config.style}
                  onValueChange={(value) => updateConfig('style', value)}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_STYLE_OPTIONS.map((style) => (
                      <SelectItem key={style} value={style}>
                        {style}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='grid gap-2'>
              <Label>{t('Response format')}</Label>
              <Select
                value={config.response_format}
                onValueChange={(value) =>
                  updateConfig(
                    'response_format',
                    value as ImageGenerationRequest['response_format']
                  )
                }
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='url'>url</SelectItem>
                  <SelectItem value='b64_json'>b64_json</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className='w-full'
              disabled={isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <Loader2Icon className='size-4 animate-spin' />
              ) : (
                <SparklesIcon className='size-4' />
              )}
              {isGenerating ? t('Generating') : t('Generate')}
            </Button>
          </CardContent>
        </Card>

        <div className='bg-muted/20 grid min-h-[480px] gap-4 rounded-lg border p-3 md:p-4'>
          {results.length === 0 ? (
            <div className='text-muted-foreground flex min-h-[420px] flex-col items-center justify-center gap-3 text-center'>
              <ImageIcon className='size-10' />
              <div className='grid gap-1'>
                <p className='text-foreground text-sm font-medium'>
                  {t('No images yet')}
                </p>
                <p className='max-w-sm text-sm'>
                  {t('Your generated images will appear here.')}
                </p>
              </div>
            </div>
          ) : (
            <div className='grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-3'>
              {results.map((result, index) => {
                const source = resultSource(result)
                return (
                  <Card
                    className='overflow-hidden rounded-lg py-0'
                    key={`${source}-${index}`}
                  >
                    <div className='bg-background aspect-square w-full overflow-hidden'>
                      {source ? (
                        <img
                          alt={result.revised_prompt || config.prompt}
                          className='size-full object-cover'
                          src={source}
                        />
                      ) : (
                        <div className='text-muted-foreground flex size-full items-center justify-center text-sm'>
                          {t('Unsupported image data')}
                        </div>
                      )}
                    </div>
                    <CardContent className='grid gap-3 p-3'>
                      {result.revised_prompt && (
                        <p className='text-muted-foreground line-clamp-3 text-xs'>
                          {result.revised_prompt}
                        </p>
                      )}
                      <Button
                        disabled={!source}
                        onClick={() => downloadResult(result, index)}
                        size='sm'
                        variant='outline'
                      >
                        <DownloadIcon className='size-4' />
                        {t('Download')}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
