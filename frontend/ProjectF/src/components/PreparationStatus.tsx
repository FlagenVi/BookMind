import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '../api/documents'
import { Button } from './ui/button'
import { SummaryPanel } from './SummaryPanel'

export function PreparationStatus({ id }: { id: string }) {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: ['documents', 'preparation', id],
    queryFn: ({ signal }) => documentsApi.preparation(id, signal),
    refetchInterval: (query) =>
      ['queued', 'processing'].includes(query.state.data?.status ?? '')
        ? 1000
        : false,
  })
  const start = useMutation({
    mutationFn: () => documentsApi.prepare(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['documents', 'preparation', id] }),
  })
  if (status.isPending)
    return (
      <p role="status" className="mt-5 text-sm">
        Проверка подготовки…
      </p>
    )
  if (status.isError)
    return (
      <div role="alert" className="mt-5">
        <p>{status.error.message}</p>
        <Button
          variant="outline"
          className="mt-2"
          onClick={() => void status.refetch()}
        >
          Повторить
        </Button>
      </div>
    )
  const data = status.data
  const percent = data.totalCharacters
    ? Math.floor((100 * (data.processedCharacters ?? 0)) / data.totalCharacters)
    : 0
  return (
    <section className="mt-6 rounded-xl bg-accent-soft p-5">
      <h2 className="font-semibold text-accent">Подготовка к суммаризации</h2>
      <p role="status" className="mt-2 text-sm text-accent">
        {data.status === 'ready'
          ? `Документ подготовлен: ${data.processedParts} частей.`
          : data.status === 'queued'
            ? 'Документ в очереди.'
            : data.status === 'processing'
              ? `Подготовлено частей: ${data.processedParts}. Обработано ${percent}% текста.`
              : data.status === 'failed'
                ? data.errorMessage
                : 'Разделите сохранённый текст на части для дальнейшего изложения.'}
      </p>
      {['queued', 'processing', 'ready'].includes(data.status) && (
        <progress
          aria-label="Подготовка текста"
          className="mt-3 h-2 w-full accent-teal-700"
          max={100}
          value={percent}
        />
      )}
      {['not_started', 'failed'].includes(data.status) && (
        <Button
          className="mt-3"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {start.isPending
            ? 'Постановка в очередь…'
            : data.status === 'failed'
              ? 'Продолжить обработку'
              : 'Подготовить текст'}
        </Button>
      )}
      {start.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {start.error.message}
        </p>
      )}
      {data.status === 'ready' && <SummaryPanel id={id} />}
    </section>
  )
}
