import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BookOpen, Sparkles } from 'lucide-react'
import { booksApi } from '../api/books'
import { readingProgress, recallPath } from '../library/recall'
import { Button } from './ui/button'

/** The book read most recently, with the two main actions: keep reading or recall what was read. */
export function ContinueReading() {
  // Shares the cache with the sidebar's "Читаю сейчас" card.
  const current = useQuery({
    queryKey: ['books', 'sidebar-current'],
    queryFn: ({ signal }) =>
      booksApi.list(0, { status: 'reading', sort: 'recent' }, signal),
  })
  const book = current.data?.items[0]
  if (!book) return null
  const progress = readingProgress(book.positionOffset, book.textLength)

  return (
    <section
      aria-labelledby="continue-reading-title"
      className="mt-7 flex flex-col gap-5 rounded-2xl border border-accent-line bg-surface p-4 sm:flex-row sm:items-center sm:p-5"
    >
      <Link
        to={`/library/${book.id}/read`}
        className="aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-accent-soft shadow-sm"
        aria-hidden="true"
        tabIndex={-1}
      >
        {book.hasCover ? (
          <img
            src={`/api/books/${encodeURIComponent(book.id)}/cover`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full place-items-center text-accent">
            <BookOpen size={24} />
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Продолжить чтение
        </p>
        <h2
          id="continue-reading-title"
          className="mt-2 line-clamp-2 text-xl font-semibold"
        >
          {book.title}
        </h2>
        {book.author && (
          <p className="mt-1 truncate text-sm text-muted">{book.author}</p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-muted">
            {progress}% прочитано
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:w-56 sm:shrink-0">
        <Button asChild>
          <Link to={`/library/${book.id}/read`}>
            <BookOpen size={17} aria-hidden="true" /> Продолжить
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={recallPath(book.id)}>
            <Sparkles size={17} aria-hidden="true" /> Вспомнить прочитанное
          </Link>
        </Button>
        <p className="text-center text-xs text-muted">
          Краткое изложение без спойлеров
        </p>
      </div>
    </section>
  )
}
