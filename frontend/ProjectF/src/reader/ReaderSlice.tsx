import { useCallback } from 'react'
import type {
  BookSearchItem,
  Highlight,
  SectionContent,
  SectionLink,
} from '../api/books'
import { LazyBookImage } from './LazyBookImage'
import { segmentReaderText } from './textSegments'
import type { ReaderUnit } from './virtualGeometry'

const markColors: Record<Highlight['color'], string> = {
  yellow: 'bg-amber-200/80 text-[#292722]',
  green: 'bg-emerald-200/80 text-[#292722]',
  blue: 'bg-sky-200/80 text-[#292722]',
  pink: 'bg-pink-200/80 text-[#292722]',
}

function DecoratedText({
  text,
  baseOffset,
  sectionStartOffset,
  highlights,
  searchMatches,
  activeSearchIndex,
  links,
  onNavigateLink,
}: {
  text: string
  baseOffset: number
  sectionStartOffset: number
  highlights: Highlight[]
  searchMatches: BookSearchItem[]
  activeSearchIndex: number | null
  links: SectionLink[]
  onNavigateLink: (link: SectionLink) => void
}) {
  return segmentReaderText({
    text,
    baseOffset,
    sectionStartOffset,
    highlights,
    searchMatches,
    activeSearchIndex,
    links,
  }).map((segment) => {
    const className = [
      segment.highlight ? markColors[segment.highlight.color] : '',
      segment.search === 'active'
        ? 'bg-orange-300/90 text-[#292722] ring-1 ring-orange-500/70'
        : segment.search === 'visible'
          ? 'bg-amber-200/80 text-[#292722]'
          : '',
      segment.highlight || segment.search ? 'rounded-sm' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const content = (
      <span className={className || undefined} title={segment.highlight?.note}>
        {segment.text}
      </span>
    )
    return segment.link ? (
      <button
        key={`${segment.startOffset}-${segment.endOffset}`}
        type="button"
        className="inline rounded-sm text-inherit underline decoration-current/50 decoration-dotted underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        title={
          segment.link.kind === 'note'
            ? 'Перейти к примечанию'
            : 'Перейти по внутренней ссылке'
        }
        onClick={() => onNavigateLink(segment.link!)}
      >
        {content}
      </button>
    ) : (
      <span key={`${segment.startOffset}-${segment.endOffset}`}>{content}</span>
    )
  })
}

export function ReaderSlice({
  bookId,
  unit,
  content,
  viewport,
  highlights,
  searchMatches,
  activeSearchIndex,
  onNavigateLink,
  fontClass,
  fontSize,
  lineHeight,
  estimatedHeight,
  error,
  onRetry,
  onNode,
}: {
  bookId: string
  unit: ReaderUnit
  content?: SectionContent
  viewport: HTMLElement | null
  highlights: Highlight[]
  searchMatches: BookSearchItem[]
  activeSearchIndex: number | null
  onNavigateLink: (link: SectionLink) => void
  fontClass: string
  fontSize: number
  lineHeight: number
  estimatedHeight: number
  error?: Error | null
  onRetry?: () => void
  onNode: (unitId: string, node: HTMLElement | null) => void
}) {
  const ref = useCallback(
    (node: HTMLElement | null) => onNode(unit.id, node),
    [onNode, unit.id],
  )
  const text = content?.content.slice(unit.localStart, unit.localEnd)
  return (
    <article
      ref={ref}
      data-reader-slice
      data-unit-id={unit.id}
      data-section-number={unit.sectionNumber}
      data-base={unit.startOffset}
      data-end={unit.endOffset}
      data-loaded={text !== undefined || undefined}
      className={`reader-page w-full whitespace-pre-wrap break-words ${unit.isSectionStart && unit.startOffset > 0 ? 'pt-14' : ''} ${fontClass}`}
      style={{
        minHeight: text === undefined ? estimatedHeight : undefined,
        fontSize,
        lineHeight,
      }}
    >
      {unit.isSectionStart && !!content?.assets.length && (
        <div className="mb-8 grid gap-5">
          {content.assets.map((asset) => (
            <LazyBookImage
              key={asset.id}
              bookId={bookId}
              assetId={asset.id}
              viewport={viewport}
            />
          ))}
        </div>
      )}
      {text !== undefined ? (
        <div data-reader-text>
          <DecoratedText
            text={text}
            baseOffset={unit.startOffset}
            sectionStartOffset={unit.sectionStartOffset}
            highlights={highlights}
            searchMatches={searchMatches}
            activeSearchIndex={activeSearchIndex}
            links={content?.links ?? []}
            onNavigateLink={onNavigateLink}
          />
        </div>
      ) : error ? (
        <div className="grid min-h-32 place-items-center rounded-xl bg-danger-soft p-5 text-center text-sm">
          <div>
            <p>Не удалось загрузить соседний раздел.</p>
            {onRetry && (
              <button className="mt-2 underline" onClick={onRetry}>
                Повторить
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className="grid min-h-32 place-items-center text-sm text-muted"
          role="status"
        >
          Загружаем раздел…
        </div>
      )}
    </article>
  )
}
