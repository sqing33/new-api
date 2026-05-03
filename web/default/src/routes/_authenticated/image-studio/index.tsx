import { createFileRoute } from '@tanstack/react-router'
import { AppHeader, Main } from '@/components/layout'
import { ImageStudio } from '@/features/image-studio'

export const Route = createFileRoute('/_authenticated/image-studio/')({
  component: ImageStudioPage,
})

function ImageStudioPage() {
  return (
    <>
      <AppHeader />
      <Main className='p-0'>
        <ImageStudio />
      </Main>
    </>
  )
}
