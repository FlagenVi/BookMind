import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, RefreshCw, Settings2, Sparkles } from 'lucide-react'
import { request } from '../api/client'
import { Button } from './ui/button'

interface RecallState {
  status: string
  configured: boolean
  text?: string
  errorMessage?: string
  activeJob?: { scope: string; level: string }
  readBoundary?: number
  readPercent?: number
  previousText?: string
  previousPercent?: number
  baseBoundary?: number | null
  inputCharacters?: number | null
  sourceCharacters?: number | null
}

const activeStatuses = ['queued', 'running', 'waiting']

function savedLevel(id: string) {
  try {
    const saved = localStorage.getItem(`summary-level:${id}`)
    return saved && ['short', 'medium', 'detailed'].includes(saved)
      ? saved
      : 'medium'
  } catch {
    return 'medium'
  }
}

/**
 * The spoiler-free summary as a compact card above the book chat. Detailed options
 * (scope, detail level, drafts) stay in the full summary panel behind the gear button.
 */
export function RecallCard({
  id,
  onOpenSettings,
}: {
  id: string
  onOpenSettings: () => void
}) {
  const client = useQueryClient()
  const [level] = useState(() => savedLevel(id))
  const [expanded, setExpanded] = useState(false)
  // Same key as SummaryPanel, so both views share one cached state.
  const queryKey = ['documents', 'summary', id, level, 'read', -1]
  const summary = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      request<RecallState>(
        `/documents/${id}/summary?${new URLSearchParams({ level, scope: 'read', sectionNumber: '-1' })}`,
        { signal },
      ),
    refetchInterval: (query) =>
      query.state.data?.activeJob ||
      activeStatuses.includes(query.state.data?.status ?? '')
        ? 3000
        : false,
  })
  const start = useMutation({
    mutationFn: () =>
      request<void>(`/documents/${id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, scope: 'read', sectionNumber: -1 }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  })

  const state = summary.data
  const active = !!state && activeStatuses.includes(state.status)
  const ready = state?.status === 'ready' && !!state.text
  const text = ready ? state.text : state?.previousText
  const busyElsewhere =
    !!state?.activeJob &&
    !active &&
    (state.activeJob.scope !== 'read' || state.activeJob.level !== level)
  const noProgress = state?.readBoundary === 0
  const canStart =
    !!state?.configured &&
    !noProgress &&
    !active &&
    !busyElsewhere &&
    !start.isPending &&
    ['not_started', 'failed', 'stale'].includes(state?.status ?? '')

  let caption = ''
  if (ready) caption = `Прочитанное до ≈${state.readPercent ?? 0}% книги`
  else if (state?.previousText)
    caption = `Пересказ до ≈${state.previousPercent ?? 0}% · вы дочитали до ≈${state.readPercent ?? 0}%`
  else if (state?.readPercent && !noProgress)
    caption = `Охватит прочитанное, ≈${state.readPercent}% книги, без спойлеров`

  return (
    <section
      aria-labelledby="recall-card-title"
      className="shrink-0 rounded-2xl border border-accent-line bg-surface p-4"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Sparkles size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="recall-card-title" className="font-semibold">
            Вспомнить прочитанное
          </h3>
          {caption && <p className="truncate text-xs text-muted">{caption}</p>}
        </div>
        <Button
          variant="outline"
          className="shrink-0 px-2.5"
          aria-label="Настройки пересказа"
          title="Настройки пересказа: объём, подробность, черновики"
          onClick={onOpenSettings}
        >
          <Settings2 size={17} aria-hidden="true" />
        </Button>
      </div>

      {summary.isPending && (
        <p role="status" className="mt-3 text-sm text-muted">
          Загрузка…
        </p>
      )}
      {summary.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {summary.error.message}
        </p>
      )}
      {state && !state.configured && (
        <p className="mt-3 text-sm text-warning">
          Пересказ недоступен: на сервере не настроен DeepSeek.
        </p>
      )}
      {noProgress && (
        <p className="mt-3 text-sm text-muted">
          Начните читать — и здесь можно будет кратко вспомнить прочитанное без
          спойлеров.
        </p>
      )}

      {text && (
        <div className="mt-3">
          <p
            className={`whitespace-pre-wrap break-words text-sm leading-6 ${expanded ? 'project-scrollbar max-h-[40vh] overflow-y-auto pr-1' : 'line-clamp-4'}`}
          >
            {text}
          </p>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Свернуть' : 'Показать полностью'}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      )}

      {active && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-accent"
        >
          <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
          {state.status === 'waiting'
            ? 'DeepSeek занят, пересказ продолжится автоматически.'
            : 'Готовим пересказ прочитанного…'}
        </p>
      )}
      {busyElsewhere && (
        <p className="mt-3 text-sm text-muted">
          Сейчас готовится другой пересказ этой книги. Его можно открыть в
          настройках.
        </p>
      )}
      {state?.status === 'failed' && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.errorMessage ?? 'Не удалось подготовить пересказ.'}
        </p>
      )}
      {start.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {start.error.message}
        </p>
      )}

      {canStart && (
        <Button className="mt-3 w-full" onClick={() => start.mutate()}>
          {state?.status === 'failed' ? (
            'Повторить'
          ) : state?.previousText || state?.status === 'stale' ? (
            <>
              <RefreshCw size={16} aria-hidden="true" /> Обновить до текущего
              места
            </>
          ) : (
            <>
              <Sparkles size={16} aria-hidden="true" /> Вспомнить прочитанное
            </>
          )}
        </Button>
      )}
      {start.isPending && (
        <p role="status" className="mt-3 text-sm text-muted">
          Ставим в очередь…
        </p>
      )}
      {ready &&
        state.baseBoundary != null &&
        !!state.inputCharacters &&
        !!state.sourceCharacters && (
          <p className="mt-2 text-[11px] text-muted">
            Дополнен прежний пересказ: в модель отправлено в{' '}
            {(state.sourceCharacters / state.inputCharacters).toLocaleString(
              'ru-RU',
              { maximumFractionDigits: 1 },
            )}{' '}
            раза меньше текста.
          </p>
        )}
    </section>
  )
}
