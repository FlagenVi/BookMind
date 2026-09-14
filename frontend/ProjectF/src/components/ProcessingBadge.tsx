export interface ProcessingState {
  preparation: string | null
  processed: number | null
  total: number | null
  status: string | null
  level: string | null
  round: number | null
  steps: number
  done: number
}
export function ProcessingBadge({ state }: { state?: ProcessingState }) {
  if (!state) return null
  const status = state.status ?? state.preparation ?? 'not_started'
  const summary = !!state.status
  const active = ['queued', 'running', 'waiting', 'processing'].includes(status)
  const label =
    status === 'ready'
      ? summary
        ? 'Изложение готово'
        : 'Текст подготовлен'
      : status === 'failed'
        ? 'Ошибка · можно продолжить'
        : status === 'waiting'
          ? 'Ожидание квоты / повторной попытки'
          : status === 'queued'
            ? 'В очереди'
            : status === 'running'
              ? 'Формируется изложение'
              : status === 'processing'
                ? 'Подготовка текста'
                : 'Не запущено'
  const done = summary ? state.done : (state.processed ?? 0)
  const total = summary ? state.steps : (state.total ?? 0)
  return (
    <div className="mt-4 space-y-2">
      <span
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${status === 'failed' ? 'bg-danger-soft text-danger' : status === 'ready' ? 'bg-success-soft text-success' : active ? 'bg-accent-soft text-accent' : 'bg-subtle text-secondary'}`}
      >
        {active && (
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-current motion-safe:animate-pulse"
          />
        )}
        {label}
      </span>
      {active && total > 0 && (
        <>
          <progress
            aria-label={
              summary
                ? 'Прогресс текущего этапа изложения'
                : 'Прогресс подготовки текста'
            }
            className="block h-2 w-full accent-teal-600"
            value={done}
            max={total}
          />
          <p className="text-xs text-muted">
            {summary
              ? `Этап ${(state.round ?? 0) + 1}: ${done} из ${total} шагов`
              : `Подготовлено ${Math.round((done / total) * 100)}%`}
          </p>
        </>
      )}
    </div>
  )
}
