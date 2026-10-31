import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../api/client'
import { Button } from './ui/button'
import { NativeSelect } from './ui/native-select'
import { ChapterResult, type SummarySection } from './ChapterResult'

interface SummaryState {
  sections?: SummarySection[]
  activeJob?: { level: string; scope: string; sectionNumber: number; status: string }
  status: string
  configured: boolean
  pipelineVersion?: number
  round?: number
  doneSteps?: number
  totalSteps?: number
  tokensUsed?: number
  text?: string
  partialText?: string
  errorMessage?: string
  nextAttemptAt?: string
  readBoundary?: number
  readPercent?: number
  baseBoundary?: number | null
  basePercent?: number
  inputCharacters?: number | null
  sourceCharacters?: number | null
}
export function SummaryPanel({
  id,
  chapters,
}: {
  id: string
  chapters?: { number: number; title: string; role: string }[]
}) {
  const [params] = useSearchParams()
  const [level, setLevel] = useState(() => {
    const requested = params.get('level')
    if (requested && ['short', 'medium', 'detailed'].includes(requested))
      return requested
    try {
      const saved = localStorage.getItem(`summary-level:${id}`)
      return saved && ['short', 'medium', 'detailed'].includes(saved)
        ? saved
        : 'medium'
    } catch {
      return 'medium'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(`summary-level:${id}`, level)
    } catch {
      // The selected level still works when browser storage is unavailable.
    }
  }, [id, level])
  const [copyMessage, setCopyMessage] = useState('')
  // Inside the reader the spoiler-free summary is the default; the server sets its boundary.
  const [scope, setScope] = useState(chapters ? 'read' : 'whole')
  const mainChapters = chapters?.filter((chapter) => chapter.role === 'main') ?? []
  const [sectionNumber, setSectionNumber] = useState(mainChapters[0]?.number ?? -1)
  const client = useQueryClient()
  const selectedSection = scope === 'whole' || scope === 'read' ? -1 : sectionNumber
  const queryKey = ['documents', 'summary', id, level, scope, selectedSection]
  const query = new URLSearchParams({ level, scope, sectionNumber: String(selectedSection) })
  const summary = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      request<SummaryState>(`/documents/${id}/summary?${query.toString()}`, {
        signal,
      }),
    refetchInterval: (query) =>
      query.state.data?.activeJob ||
      ['queued', 'running', 'waiting'].includes(query.state.data?.status ?? '')
        ? 3000
        : false,
  })
  const start = useMutation({
    mutationFn: () =>
      request<void>(`/documents/${id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, scope, sectionNumber: selectedSection }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  })
  const state = summary.data
  const active =
    !!state && ['queued', 'running', 'waiting'].includes(state.status)
  const failedNew = state?.status === 'failed' && (state.pipelineVersion ?? 0) >= 4
  const truncated = failedNew && state.errorMessage?.startsWith('Модель исчерпала бюджет ответа')
  const repairAvailable = failedNew && !!state.partialText && !truncated
  const noProgress = scope === 'read' && state?.readBoundary === 0
  const activeJob = state?.activeJob
  const activeElsewhere =
    !!activeJob &&
    (activeJob.level !== level ||
      activeJob.scope !== scope ||
      activeJob.sectionNumber !==
        (scope === 'read' ? state?.readBoundary : selectedSection))
  const activeForEarlierPosition =
    activeElsewhere && activeJob.scope === 'read' && scope === 'read'
  return (
    <section className="mt-6 rounded-xl border border-accent-line bg-surface p-5">
      <h2 className="text-lg font-semibold">
        {chapters ? 'Вспомнить прочитанное' : 'Изложение материала'}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {chapters
          ? 'Краткий пересказ поможет вернуться к книге после перерыва: события, герои и то, чем всё закончилось на вашем месте. Готовые пересказы сохраняются.'
          : 'Выбранный текст отправляется в DeepSeek целиком. Если он слишком большой, главы объединяются в несколько томов. Результат сохраняется автоматически.'}
      </p>
      {chapters && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Объём текста
            <NativeSelect
              className="mt-2 min-h-12 w-full rounded-xl border border-line px-4"
              value={scope}
              disabled={start.isPending}
              onChange={(event) => { setScope(event.target.value); start.reset() }}
            >
              <option value="read">Только прочитанное</option>
              <option value="whole">Вся книга (со спойлерами)</option>
              {mainChapters.length > 0 && (
                <>
                  <option value="through_chapter">До выбранной главы включительно</option>
                  <option value="chapter">Только одна глава</option>
                </>
              )}
            </NativeSelect>
          </label>
          {(scope === 'chapter' || scope === 'through_chapter') && (
            <label className="block text-sm font-medium">
              Глава
              <NativeSelect
                className="mt-2 min-h-12 w-full rounded-xl border border-line px-4"
                value={sectionNumber}
                disabled={start.isPending}
                onChange={(event) => setSectionNumber(Number(event.target.value))}
              >
                {mainChapters.map((chapter) => <option key={chapter.number} value={chapter.number}>{chapter.title}</option>)}
              </NativeSelect>
            </label>
          )}
        </div>
      )}
      {scope === 'read' && state?.readBoundary !== undefined && (
        <p className="mt-3 text-sm text-muted">
          {noProgress
            ? 'Позиция чтения ещё не сохранена. Начните читать, и изложение охватит только прочитанное.'
            : `Пересказ охватит книгу до самого дальнего места, до которого вы дочитали (≈${state.readPercent ?? 0}%). Дальнейший текст в него не попадает — спойлеров не будет.`}
        </p>
      )}
      <label htmlFor="summary-level" className="mt-4 block text-sm font-medium">
        Подробность общего обзора
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <NativeSelect
          id="summary-level"
          containerClassName="w-full sm:w-auto"
          className="min-h-12 w-full rounded-xl border border-line px-4 py-3"
          disabled={start.isPending || !!state?.activeJob}
          value={level}
          onChange={(event) => {
            setLevel(event.target.value)
            start.reset()
            setCopyMessage('')
          }}
        >
          <option value="short">Кратко</option>
          <option value="medium">Средне</option>
          <option value="detailed">Подробно</option>
        </NativeSelect>
        {state && ['not_started', 'failed', 'stale'].includes(state.status) && (
          <Button
            className="min-h-12 w-full sm:w-auto"
            disabled={!state.configured || start.isPending || !!state.activeJob || noProgress}
            onClick={() => start.mutate()}
          >
            {start.isPending
              ? 'Постановка в очередь…'
              : state.status === 'stale'
                ? 'Обновить изложение'
                : state.status === 'failed'
                ? state.pipelineVersion && state.pipelineVersion < 4
                  ? 'Создать заново одним запросом'
                  : repairAvailable
                    ? 'Сократить черновик'
                    : 'Повторить запрос'
                : state.activeJob
                  ? 'Обработка продолжается'
                  : 'Сформировать изложение'}
          </Button>
        )}
      </div>
      {summary.isPending && (
        <p role="status" className="mt-3 text-sm">
          Загрузка состояния…
        </p>
      )}
      {summary.isError && (
        <div role="alert" className="mt-3">
          <p>{summary.error.message}</p>
          <Button variant="outline" onClick={() => void summary.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {state && !state.configured && (
        <p className="mt-3 text-sm text-warning">
          На сервере ещё не настроено подключение к DeepSeek.
        </p>
      )}
      {activeElsewhere && (
        <div
          role="status"
          className="mt-4 rounded-xl bg-accent-soft p-4 text-sm text-accent"
        >
          {activeForEarlierPosition
            ? 'Изложение для прежней позиции чтения ещё формируется. Новый запуск станет доступен после его завершения.'
            : 'Документ уже обрабатывается. Повторный запуск недоступен.'}
          {!activeForEarlierPosition && (
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => {
                setLevel(activeJob.level)
                setScope(activeJob.scope)
                if (activeJob.scope !== 'read') setSectionNumber(activeJob.sectionNumber)
                start.reset()
              }}
            >
              Открыть текущую обработку
            </Button>
          )}
        </div>
      )}
      {state?.status === 'stale' && (
        <p role="status" className="mt-3 text-sm text-warning">
          Главы новеллы изменились. Прежнее изложение относится к старой версии текста.
          Обновление отправит новый платный запрос в DeepSeek только после нажатия кнопки.
        </p>
      )}
      {active && (
        <p role="status" className="mt-4 text-sm text-accent">
          {state.status === 'waiting'
            ? `${state.errorMessage} Следующая попытка: ${state.nextAttemptAt ? new Date(state.nextAttemptAt).toLocaleString('ru-RU') : 'позже'}.`
            : state.pipelineVersion && state.pipelineVersion >= 4
              ? state.totalSteps === 1
                ? 'Обрабатываем выбранный текст одним запросом.'
                : `Готово ${state.doneSteps ?? 0} из ${state.totalSteps ?? 0} крупных частей. Затем будет создан общий обзор.`
              : `Старое задание: этап ${(state.round ?? 0) + 1}, готово ${state.doneSteps ?? 0} из ${state.totalSteps ?? 0} шагов.`}
        </p>
      )}
      {state?.status === 'failed' && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.pipelineVersion && state.pipelineVersion < 4
            ? 'Старый многошаговый пересказ остановлен. Новый запуск использует один запрос или крупные тома; готовые старые фрагменты не войдут в новый результат.'
            : state.errorMessage}{' '}
          {failedNew && (state.doneSteps ?? 0) > 0 ? 'Готовые части сохранены.' : ''}
        </p>
      )}
      {failedNew && (
        <p className="mt-2 text-sm text-muted">
          {truncated && state.partialText
            ? 'Черновик ответа сохранён, но он может не охватывать конец книги. Для полного изложения «Повторить запрос» заново отправит выбранный текст или текущий том в DeepSeek и будет платным.'
            : repairAvailable
            ? 'Черновик ответа превышает заданный объём. «Сократить черновик» отправит только его в DeepSeek; это дополнительный платный запрос.'
            : 'Черновика для этого шага нет. «Повторить запрос» заново отправит выбранный текст или текущий том в DeepSeek и будет платным. Можно выбрать меньшую подробность — это тоже новый платный запрос.'}
        </p>
      )}
      {failedNew && state.partialText && (
        <details className="mt-3 rounded-xl border border-line p-3 text-sm">
          <summary className="cursor-pointer font-medium">Показать незавершённый черновик</summary>
          <p className="mt-3 whitespace-pre-wrap break-words leading-6">{state.partialText}</p>
        </details>
      )}
      {start.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {start.error.message}
        </p>
      )}
      {!!state?.sections?.length && (
        <div className="mt-6 space-y-3">
          <h3 className="font-semibold">{state.pipelineVersion && state.pipelineVersion >= 4 ? 'Части большой книги' : 'Пересказы разделов'}</h3>
          <p className="text-sm text-muted">
            {state.pipelineVersion && state.pipelineVersion >= 4
              ? 'Части формируются только тогда, когда весь выбранный текст не помещается в один запрос.'
              : 'Разделы определяются по заголовкам. Примечания и предисловие обрабатываются отдельно.'}
          </p>
          {state.sections.map((section) => (
            <ChapterResult
              key={`${level}-${section.number}`}
              id={id}
              level={level}
              section={section}
              active={active}
              scope={scope}
              scopeSectionNumber={selectedSection}
              direct={!!state.pipelineVersion && state.pipelineVersion >= 4}
            />
          ))}
        </div>
      )}
      {state?.text && (
        <>
          <h3 className="mt-6 font-semibold">Общий обзор</h3>
          <p className="mt-3 whitespace-pre-wrap break-words leading-7">
            {state.text}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(state.text!).then(
                () => setCopyMessage('Скопировано'),
                () =>
                  setCopyMessage(
                    'Не удалось скопировать. Выделите текст вручную.',
                  ),
              )
            }}
          >
            Скопировать
          </Button>
          <p role="status" className="mt-2 text-sm">
            {copyMessage}
          </p>
        </>
      )}
      {state?.baseBoundary != null &&
        !!state.inputCharacters &&
        !!state.sourceCharacters && (
          <p className="mt-3 text-xs text-muted">
            Изложение дополнено на основе прежнего пересказа до ≈
            {state.basePercent ?? 0}% книги: в модель отправлено{' '}
            {state.inputCharacters.toLocaleString('ru-RU')} символов вместо{' '}
            {state.sourceCharacters.toLocaleString('ru-RU')} (в{' '}
            {(state.sourceCharacters / state.inputCharacters).toLocaleString('ru-RU', {
              maximumFractionDigits: 1,
            })}{' '}
            раза меньше).
          </p>
        )}
      {!!state?.tokensUsed && (
        <p className="mt-3 text-xs text-muted">
          Учтено токенов в ответах API:{' '}
          {state.tokensUsed.toLocaleString('ru-RU')}
        </p>
      )}
    </section>
  )
}
