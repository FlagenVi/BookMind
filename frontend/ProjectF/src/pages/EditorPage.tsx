import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Sparkles } from 'lucide-react'
import { documentsApi } from '../api/documents'
import { Button } from '../components/ui/button'
import { DocumentUpload } from '../components/DocumentUpload'

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Укажите название')
    .max(200, 'Не более 200 символов'),
  content: z
    .string()
    .trim()
    .min(1, 'Введите текст для обработки')
    .max(100000, 'Не более 100 000 символов'),
})
type Fields = z.infer<typeof schema>
const field =
  'mt-2 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm'

export function EditorPage() {
  const client = useQueryClient()
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', content: '' },
  })
  const save = useMutation({
    mutationFn: documentsApi.create,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] })
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const content = useWatch({ control, name: 'content' })
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        Работа с текстом
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
        Больше смысла. Меньше текста.
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        Добавьте материал, чтобы сохранить его и подготовить к формированию
        сжатого изложения.
      </p>
      <DocumentUpload />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <form
          onSubmit={handleSubmit((data) => save.mutate(data))}
          onChange={() => save.reset()}
          className="rounded-2xl border border-line bg-surface p-5 md:p-7"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Исходный текст</h2>
            <span className="text-xs text-muted">01 / Материал</span>
          </div>
          <fieldset
            disabled={save.isPending}
            className="mt-6 space-y-5 disabled:opacity-60"
          >
            <div>
              <label htmlFor="title" className="text-sm font-medium">
                Название
              </label>
              <input
                id="title"
                {...register('title')}
                aria-invalid={!!errors.title}
                aria-describedby={errors.title ? 'title-error' : undefined}
                className={field}
                placeholder="Например, статья об искусственном интеллекте"
              />
              {errors.title && (
                <p
                  id="title-error"
                  role="alert"
                  className="mt-2 text-sm text-danger"
                >
                  {errors.title.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="content" className="text-sm font-medium">
                Текст материала
              </label>
              <textarea
                id="content"
                {...register('content')}
                aria-invalid={!!errors.content}
                aria-describedby={errors.content ? 'content-error' : undefined}
                className={`${field} min-h-64 resize-y leading-7`}
                placeholder="Вставьте сюда статью, лекцию или другой текст…"
              />
              <div className="mt-2 text-right text-xs text-muted">
                {content.length.toLocaleString('ru-RU')} / 100 000 символов
              </div>
              {errors.content && (
                <p
                  id="content-error"
                  role="alert"
                  className="text-sm text-danger"
                >
                  {errors.content.message}
                </p>
              )}
            </div>
          </fieldset>
          <Button
            type="submit"
            variant="outline"
            className="mt-6"
            disabled={save.isPending}
          >
            <Save size={16} />
            {save.isPending ? 'Сохранение…' : 'Сохранить текст'}
          </Button>
          {save.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {save.error.message}
            </p>
          )}
          {save.isSuccess && (
            <p role="status" className="mt-3 text-sm text-accent">
              Текст сохранён. Он доступен в истории.
            </p>
          )}
        </form>
        <section className="flex flex-col rounded-2xl border border-line bg-surface p-5 md:p-7">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Сжатое изложение</h2>
            <Sparkles size={20} className="text-accent" />
          </div>
          <label htmlFor="compression" className="mt-6 text-sm font-medium">
            Уровень сжатия
          </label>
          <select
            id="compression"
            disabled
            className={`${field} text-muted`}
            defaultValue="medium"
          >
            <option value="short">Кратко — 20% предложений</option>
            <option value="medium">Средне — 35% предложений</option>
            <option value="detailed">Подробно — 50% предложений</option>
          </select>
          <div className="my-8 flex flex-1 flex-col items-center justify-center rounded-xl bg-page px-5 py-12 text-center">
            <span className="rounded-full bg-accent-soft p-4 text-accent">
              <Sparkles size={26} />
            </span>
            <h3 className="mt-5 font-medium">Здесь будет главное</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              Генерация доступна на странице сохранённого документа после
              подготовки текста. Откройте документ в истории и выберите
              подробность изложения.
            </p>
          </div>
          <Button disabled>
            <Sparkles size={16} />
            Сформировать изложение
          </Button>
        </section>
      </div>
    </>
  )
}
