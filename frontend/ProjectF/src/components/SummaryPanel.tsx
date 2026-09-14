import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../api/client'
import { Button } from './ui/button'
import { ChapterResult, type SummarySection } from './ChapterResult'

interface SummaryState {
  sections?: SummarySection[]
  activeJob?: { level: string; status: string }
  status: string
  configured: boolean
  round?: number
  doneSteps?: number
  totalSteps?: number
  tokensUsed?: number
  text?: string
  errorMessage?: string
  nextAttemptAt?: string
}
export function SummaryPanel({ id }: { id: string }) {
  const [params] = useSearchParams()
  const [level, setLevel] = useState(() =>
    ['short', 'medium', 'detailed'].includes(params.get('level') ?? '')
      ? params.get('level')!
      : 'medium',
  )
  const [copyMessage, setCopyMessage] = useState('')
  const client = useQueryClient()
  const queryKey = ['documents', 'summary', id, level]
  const summary = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      request<SummaryState>(`/documents/${id}/summary?level=${level}`, {
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
        body: JSON.stringify({ level }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  })
  const state = summary.data
  const active =
    !!state && ['queued', 'running', 'waiting'].includes(state.status)
  return (
    <section className="mt-6 rounded-xl border border-accent-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Изложение книги</h2>
      <p className="mt-2 text-sm text-muted">
        По кнопке текст будет отправлен в Groq. Результаты частей и итог
        сохранятся автоматически. Для большой книги обработка может занять
        несколько часов.
      </p>
      <label htmlFor="summary-level" className="mt-4 block text-sm font-medium">
        Подробность общего обзора
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          id="summary-level"
          className="min-h-12 w-full rounded-xl border border-line px-4 py-3 sm:w-auto"
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
        </select>
        {state && ['not_started', 'failed'].includes(state.status) && (
          <Button
            className="min-h-12 w-full sm:w-auto"
            disabled={!state.configured || start.isPending || !!state.activeJob}
            onClick={() => start.mutate()}
          >
            {start.isPending
              ? 'Постановка в очередь…'
              : state.status === 'failed'
                ? 'Продолжить'
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
          На сервере ещё не настроено подключение к Groq.
        </p>
      )}
      {state?.activeJob && state.activeJob.level !== level && (
        <div
          role="status"
          className="mt-4 rounded-xl bg-accent-soft p-4 text-sm text-accent"
        >
          Документ уже обрабатывается. Повторный запуск недоступен.
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              setLevel(state.activeJob!.level)
              start.reset()
            }}
          >
            Открыть текущую обработку
          </Button>
        </div>
      )}
      {active && (
        <p role="status" className="mt-4 text-sm text-accent">
          {state.status === 'waiting'
            ? `${state.errorMessage} Следующая попытка: ${state.nextAttemptAt ? new Date(state.nextAttemptAt).toLocaleString('ru-RU') : 'позже'}.`
            : `Этап ${(state.round ?? 0) + 1}: готово ${state.doneSteps ?? 0} из ${state.totalSteps ?? 0} шагов. Запросы выполняются с паузой для соблюдения квоты.`}
        </p>
      )}
      {state?.status === 'failed' && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.errorMessage} Сохранённые шаги не потеряны.
        </p>
      )}
      {start.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {start.error.message}
        </p>
      )}
      {!!state?.sections?.length && (
        <div className="mt-6 space-y-3">
          <h3 className="font-semibold">Пересказы разделов</h3>
          <p className="text-sm text-muted">
            Разделы определяются по заголовкам. Примечания и предисловие
            обрабатываются отдельно.
          </p>
          {state.sections.map((section) => (
            <ChapterResult
              key={`${level}-${section.number}`}
              id={id}
              level={level}
              section={section}
              active={active}
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
      {!!state?.tokensUsed && (
        <p className="mt-3 text-xs text-muted">
          Учтено токенов в ответах API:{' '}
          {state.tokensUsed.toLocaleString('ru-RU')}
        </p>
      )}
    </section>
  )
}
