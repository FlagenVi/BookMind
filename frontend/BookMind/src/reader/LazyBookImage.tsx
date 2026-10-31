import { useEffect, useRef, useState } from 'react'

export function LazyBookImage({
  bookId,
  assetId,
  viewport,
}: {
  bookId: string
  assetId: string
  viewport: HTMLElement | null
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const image = imageRef.current
    if (!image || !viewport || visible) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setVisible(true)
        observer.disconnect()
      },
      {
        root: viewport,
        rootMargin: `${viewport.clientHeight}px 0px ${viewport.clientHeight * 2}px 0px`,
      },
    )
    observer.observe(image)
    return () => observer.disconnect()
  }, [viewport, visible])

  return (
    <img
      ref={imageRef}
      src={
        visible
          ? `/api/books/${encodeURIComponent(bookId)}/assets/${encodeURIComponent(assetId)}`
          : undefined
      }
      alt="Иллюстрация из книги"
      className="mx-auto min-h-12 max-h-[65vh] max-w-full rounded-lg object-contain shadow-sm"
    />
  )
}
