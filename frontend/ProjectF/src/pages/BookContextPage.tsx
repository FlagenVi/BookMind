import { useQuery } from '@tanstack/react-query'
import { Archive, Sparkles } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { booksApi } from '../api/books'
import { MaterialContexts } from '../components/MaterialContexts'
import { PreparationStatus } from '../components/PreparationStatus'
import { Button } from '../components/ui/button'

export function BookContextPage() {
  const { id = '' } = useParams()
  const manifest = useQuery({
    queryKey: ['book', id, 'manifest'],
    queryFn: ({ signal }) => booksApi.manifest(id, signal),
  })
  return (
    <>
      <Button asChild variant="outline">
        <Link to={`/library/${id}/read`}>← Вернуться к чтению</Link>
      </Button>
      {manifest.isPending ? (
        <p role="status" className="mt-8">
          Загрузка книги…
        </p>
      ) : manifest.isError ? (
        <div role="alert" className="mt-8 rounded-xl bg-danger-soft p-5">
          <p>{manifest.error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void manifest.refetch()}
          >
            Повторить
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          <header className="rounded-2xl border border-line bg-surface p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-accent-soft p-2 text-accent">
                <Archive size={20} />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                  Контексты книги
                </p>
                <h1 className="mt-2 text-2xl font-semibold">
                  {manifest.data.title}
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Сохраняйте прочитанный контекст без спойлеров, текущую главу,
                  фрагмент или явно выбранную полную книгу.
                </p>
              </div>
            </div>
          </header>
          <div className="mt-5">
            <MaterialContexts
              materialId={id}
              materialType="BOOK"
              sections={manifest.data.sections}
            />
          </div>
          <div className="mt-5">
            <PreparationStatus id={id} />
          </div>
          <aside className="mt-5 flex items-start gap-3 rounded-2xl border border-dashed border-accent-line bg-accent-soft/40 p-5">
            <Sparkles size={20} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <h2 className="font-semibold">
                AI-панель подготовлена архитектурно
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Сохранённые снимки станут источниками будущего чата внутри
                ридера. Подключение DeepSeek добавим отдельным этапом, не меняя
                границы уже созданных контекстов.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
