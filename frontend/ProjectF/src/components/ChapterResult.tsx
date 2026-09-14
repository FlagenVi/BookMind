import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from '../api/client'
import { Button } from './ui/button'

export interface SummarySection {
  number: number
  heading: string
  category: string
  text: string | null
  totalParts: number
  doneParts: number
}
export function ChapterResult({
  id,
  level,
  section,
  active,
}: {
  id: string
  level: string
  section: SummarySection
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const fragments = useQuery({
    queryKey: [
      'documents',
      'summary',
      id,
      level,
      'section',
      section.number,
      offset,
    ],
    queryFn: ({ signal }) =>
      request<{ number: number; text: string | null }[]>(
        `/documents/${id}/summary/sections/${section.number}?level=${level}&offset=${offset}`,
        { signal },
      ),
    enabled: open && !section.text,
    refetchInterval: open && active && !section.text ? 3000 : false,
  })
  return (
    <details
      className="rounded-xl border border-line p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">
        {section.heading}{' '}
        <span className="text-sm font-normal text-muted">
          {section.category === 'ancillary' ? ' · Справочный раздел' : ''} ·{' '}
          {section.text
            ? 'Готово'
            : `${section.doneParts}/${section.totalParts} фрагментов`}
        </span>
      </summary>
      {open && (
        <div className="mt-3 space-y-4 text-sm leading-7">
          {section.text ? (
            <p className="whitespace-pre-wrap">{section.text}</p>
          ) : (
            <>
              <p className="text-muted">
                Промежуточные пересказы фрагментов. Изложение раздела появится
                после их объединения.
              </p>
              {fragments.isPending && <p role="status">Загрузка…</p>}
              {fragments.isError && (
                <p role="alert">{fragments.error.message}</p>
              )}
              {fragments.data?.map((part, index) => (
                <div key={part.number}>
                  <p className="font-medium">Фрагмент {offset + index + 1}</p>
                  <p className="whitespace-pre-wrap">
                    {part.text ?? 'Ещё не обработан'}
                  </p>
                </div>
              ))}
              {section.totalParts > 20 && (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    Назад
                  </Button>
                  <Button
                    variant="outline"
                    disabled={offset + 20 >= section.totalParts}
                    onClick={() => setOffset(offset + 20)}
                  >
                    Далее
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </details>
  )
}
