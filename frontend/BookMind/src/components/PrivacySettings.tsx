import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, LockKeyhole, ShieldCheck } from 'lucide-react'
import { authApi, type Profile } from '../api/auth'
import { booksApi } from '../api/books'
import { Button } from './ui/button'

const sectionOptions = [
  ['showLibrary', 'Библиотека', 'Названия и авторы книг без позиции чтения'],
  ['showStatistics', 'Статистика', 'Общее время чтения и число завершённых книг'],
  ['showActivity', 'Активность', 'Дни и минуты чтения за последний год'],
  ['showFriends', 'Друзья', 'Список подтверждённых друзей'],
] as const

export function PrivacySettings({ profile }: { profile: Profile }) {
  const client = useQueryClient()
  const [username, setUsername] = useState(profile.username ?? '')
  const [visibility, setVisibility] = useState(profile.visibility)
  const [sections, setSections] = useState({
    showLibrary: profile.showLibrary,
    showStatistics: profile.showStatistics,
    showActivity: profile.showActivity,
    showFriends: profile.showFriends,
  })
  const [genres, setGenres] = useState(profile.favoriteGenres.join(', '))
  const [featured, setFeatured] = useState(profile.featuredBookIds)
  const [bookSearch, setBookSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const books = useQuery({
    queryKey: ['privacy-book-options', bookSearch],
    queryFn: ({ signal }) => booksApi.list(0, { q: bookSearch }, signal),
  })
  const selectedDetails = useQueries({
    queries: featured.map((id) => ({
      queryKey: ['book-details', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => booksApi.details(id, signal),
    })),
  })
  const save = useMutation({
    mutationFn: () =>
      authApi.updateProfile({
        username: username.trim().toLowerCase(),
        visibility,
        ...sections,
        favoriteGenres: genres.split(',').map((value) => value.trim()).filter(Boolean),
        featuredBookIds: featured,
      }),
    onSuccess: (updated) => client.setQueryData(['me'], updated),
  })
  const publicUrl = profile.username ? `${window.location.origin}/people/${profile.username}` : ''

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7" aria-labelledby="privacy-heading">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><ShieldCheck size={19} /></span>
        <div>
          <h2 id="privacy-heading" className="text-lg font-semibold">Публичный профиль и приватность</h2>
          <p className="mt-1 text-sm text-muted">Закрыт по умолчанию. Позиция чтения и заметки никогда не публикуются.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Имя пользователя
          <span className="mt-1 block text-xs font-normal text-muted">Для поиска и ссылки: латинские буквы, цифры и _, от 3 до 24 символов.</span>
          <input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())}
            maxLength={24} autoComplete="username" placeholder="reader_name"
            className="mt-2 h-11 w-full rounded-xl border border-line bg-page px-3 text-foreground" />
        </label>
        <label className="block text-sm font-medium">
          Кто видит профиль
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as Profile['visibility'])}
            className="mt-7 h-11 w-full rounded-xl border border-line bg-page px-3 text-foreground sm:mt-8">
            <option value="private">Только я</option>
            <option value="friends">Только друзья</option>
            <option value="public">Все</option>
          </select>
        </label>
      </div>
      {publicUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Link to={`/people/${profile.username}`} className="text-accent underline underline-offset-4">Открыть мой профиль</Link>
          <Button variant="outline" type="button" onClick={async () => {
            await navigator.clipboard.writeText(publicUrl)
            setCopied(true)
          }}><Copy size={15} /> {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</Button>
        </div>
      )}

      <fieldset className="mt-6 border-t border-line pt-5">
        <legend className="text-sm font-semibold">Что показывать посетителям</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {sectionOptions.map(([key, label, hint]) => (
            <label key={key} className="flex min-h-16 items-center gap-3 rounded-xl border border-line px-3 py-2">
              <input type="checkbox" checked={sections[key]} onChange={(event) => setSections((value) => ({ ...value, [key]: event.target.checked }))}
                className="size-5 accent-primary" />
              <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-5 block text-sm font-medium">
        Любимые жанры
        <span className="mt-1 block text-xs font-normal text-muted">До шести жанров через запятую. Они видны, когда доступен профиль.</span>
        <input value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Фантастика, детектив"
          className="mt-2 h-11 w-full rounded-xl border border-line bg-page px-3 text-foreground" />
      </label>

      <div className="mt-5">
        <label htmlFor="featured-book-search" className="text-sm font-medium">Избранные книги для профиля</label>
        <p className="mt-1 text-xs text-muted">До шести книг. Выбранные книги будут видны посетителям, даже если остальная библиотека скрыта.</p>
        <input id="featured-book-search" value={bookSearch} onChange={(event) => setBookSearch(event.target.value)}
          placeholder="Найти книгу по названию" className="mt-2 h-11 w-full rounded-xl border border-line bg-page px-3 text-foreground" />
        {featured.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {featured.map((id, index) => (
              <button key={id} type="button" onClick={() => setFeatured((items) => items.filter((item) => item !== id))}
                className="rounded-full border border-accent-line bg-accent-soft px-3 py-1.5 text-xs text-accent"
                aria-label={`Убрать книгу ${selectedDetails[index]?.data?.title ?? id} из профиля`}>
                {selectedDetails[index]?.data?.title ?? 'Загружаем книгу…'} ×
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-line">
          {books.data?.items.map((book) => (
            <label key={book.id} className="flex min-h-10 items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0">
              <input type="checkbox" checked={featured.includes(book.id)}
                disabled={!featured.includes(book.id) && featured.length >= 6}
                onChange={(event) => setFeatured((items) => event.target.checked ? [...items, book.id] : items.filter((id) => id !== book.id))}
                className="size-4 accent-primary" />
              <span className="truncate">{book.title}</span>
            </label>
          ))}
          {books.data?.items.length === 0 && <p className="p-3 text-sm text-muted">Книги не найдены.</p>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={save.isPending || username.trim().length < 3} onClick={() => save.mutate()}>
          {save.isPending ? 'Сохраняем…' : 'Сохранить приватность'}
        </Button>
        {save.isSuccess && <span role="status" className="text-sm text-accent">Настройки сохранены</span>}
        {save.isError && <span role="alert" className="text-sm text-danger">{save.error.message}</span>}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted"><LockKeyhole size={14} /> Заметки, переписка и точная позиция чтения остаются личными.</p>
    </section>
  )
}
