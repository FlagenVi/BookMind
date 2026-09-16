import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import {
  BookOpen,
  FileText,
  Files,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { authApi } from './api/auth'
import { booksApi, type BookItem } from './api/books'
import { RequireAuth } from './components/RequireAuth'
import { ThemeToggle } from './components/ThemeToggle'
import { AuthPage } from './pages/AuthPage'
import { BookContextPage } from './pages/BookContextPage'
import { EditorPage } from './pages/EditorPage'
import { DocumentPage, DocumentsPage } from './pages/HistoryPage'
import { LibraryPage } from './pages/LibraryPage'
import { ProfilePage } from './pages/ProfilePage'
import { ReaderPage } from './pages/ReaderPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30000 } },
})

type NavigationItem = {
  to: string
  title: string
  Icon: LucideIcon
}

const navigation: NavigationItem[] = [
  { to: '/library', title: 'Библиотека', Icon: BookOpen },
  { to: '/documents', title: 'Документы', Icon: Files },
]

function readSidebarCollapsed() {
  try {
    return localStorage.getItem('sidebar-collapsed') === 'true'
  } catch {
    return false
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function AppShell() {
  const location = useLocation()
  const isReader = /^\/library\/[^/]+\/read\/?$/.test(location.pathname)
  const isAuth = location.pathname === '/auth'
  const hasSidebar = !isReader && !isAuth
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
    enabled: hasSidebar,
  })
  const currentBooks = useQuery({
    queryKey: ['books', 'sidebar-current'],
    queryFn: ({ signal }) =>
      booksApi.list(0, { status: 'reading', sort: 'recent' }, signal),
    enabled: hasSidebar && !!me.data,
  })

  useEffect(() => {
    if (!mobileOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileOpen])

  const closeMobile = () => setMobileOpen(false)
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      try {
        localStorage.setItem('sidebar-collapsed', String(next))
      } catch {
        // The setting remains active in this tab when storage is unavailable.
      }
      return next
    })
  }

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only">
        Перейти к содержимому
      </a>
      <div
        className={
          hasSidebar
            ? `min-h-screen md:grid ${collapsed ? 'md:grid-cols-[88px_minmax(0,1fr)]' : 'md:grid-cols-[264px_minmax(0,1fr)]'}`
            : 'min-h-screen'
        }
      >
        {hasSidebar && (
          <>
            <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur md:hidden">
              <Link
                to="/library"
                className="brand-link flex items-center gap-2.5 rounded-xl font-bold tracking-tight"
              >
                <span className="rounded-lg bg-teal-700 p-1.5 text-white">
                  <FileText size={19} aria-hidden="true" />
                </span>
                Суть текста
              </Link>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-xl border border-line text-secondary transition hover:border-accent-line hover:bg-accent-soft hover:text-accent"
                aria-label="Открыть меню"
                aria-expanded={mobileOpen}
                aria-controls="app-sidebar"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={20} aria-hidden="true" />
              </button>
            </header>

            {mobileOpen && (
              <button
                type="button"
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] md:hidden"
                aria-label="Закрыть меню"
                onClick={closeMobile}
              />
            )}

            <aside
              id="app-sidebar"
              className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[min(290px,88vw)] flex-col overflow-hidden border-r border-line bg-surface p-5 shadow-2xl transition-[transform,padding] duration-300 md:sticky md:top-0 md:z-20 md:w-auto md:translate-x-0 md:overflow-visible md:shadow-none ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'sidebar-collapsed md:p-3' : 'md:p-5'}`}
            >
              <div
                className={`relative flex shrink-0 items-center gap-2 ${collapsed ? 'md:flex-col' : ''}`}
              >
                <Link
                  to="/library"
                  title={collapsed ? 'Суть текста' : undefined}
                  className={`brand-link flex min-w-0 flex-1 items-center gap-3 rounded-xl font-bold tracking-tight ${collapsed ? 'md:justify-center' : ''}`}
                  onClick={closeMobile}
                >
                  <span className="shrink-0 rounded-xl bg-teal-700 p-2 text-white">
                    <FileText size={21} aria-hidden="true" />
                  </span>
                  <span
                    className={`truncate text-lg ${collapsed ? 'md:hidden' : ''}`}
                  >
                    Суть текста
                  </span>
                </Link>
                <button
                  type="button"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-subtle hover:text-foreground md:hidden"
                  aria-label="Закрыть меню"
                  onClick={closeMobile}
                >
                  <X size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-subtle hover:text-foreground md:grid"
                  aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
                  title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
                  onClick={toggleCollapsed}
                >
                  {collapsed ? (
                    <PanelLeftOpen size={18} aria-hidden="true" />
                  ) : (
                    <PanelLeftClose size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
              <p
                className={`mt-2 shrink-0 text-xs text-muted ${collapsed ? 'md:hidden' : ''}`}
              >
                Читайте, сохраняйте, вспоминайте
              </p>

              <NavLink
                to="/"
                end
                title={collapsed ? 'Добавить материал' : undefined}
                className={`ui-button ui-button-primary sidebar-item mt-6 flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-700 px-3 py-2.5 text-sm font-semibold text-white ${collapsed ? 'md:px-0' : ''}`}
                onClick={closeMobile}
              >
                <Plus size={18} aria-hidden="true" />
                <span className={collapsed ? 'md:hidden' : ''}>
                  Добавить материал
                </span>
                {collapsed && (
                  <span
                    className="sidebar-tooltip hidden md:block"
                    aria-hidden="true"
                  >
                    Добавить материал
                  </span>
                )}
              </NavLink>

              <nav
                aria-label="Основная навигация"
                className="mt-7 shrink-0 space-y-1"
              >
                <p
                  className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted ${collapsed ? 'md:hidden' : ''}`}
                >
                  Основное
                </p>
                {navigation.map(({ to, title, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    title={collapsed ? title : undefined}
                    className={({ isActive }) =>
                      `nav-link sidebar-item flex min-h-11 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium ${collapsed ? 'md:justify-center md:px-0' : ''} ${isActive ? 'bg-accent-soft text-accent' : 'text-secondary'}`
                    }
                    onClick={closeMobile}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className={collapsed ? 'md:hidden' : ''}>
                      {title}
                    </span>
                    {collapsed && (
                      <span
                        className="sidebar-tooltip hidden md:block"
                        aria-hidden="true"
                      >
                        {title}
                      </span>
                    )}
                  </NavLink>
                ))}
              </nav>

              <CurrentBook
                book={currentBooks.data?.items[0]}
                loading={currentBooks.isPending && !!me.data}
                collapsed={collapsed}
                onNavigate={closeMobile}
              />

              <footer className="mt-auto shrink-0 border-t border-line pt-3">
                <NavLink
                  to="/profile"
                  title={collapsed ? 'Профиль' : undefined}
                  className={({ isActive }) =>
                    `nav-link sidebar-item flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 text-sm ${collapsed ? 'md:justify-center md:px-0' : ''} ${isActive ? 'bg-accent-soft text-accent' : 'text-secondary'}`
                  }
                  onClick={closeMobile}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-soft font-semibold text-accent">
                    {me.data?.hasAvatar ? (
                      <img
                        src={`/api/auth/profile/avatar?v=${encodeURIComponent(me.data.avatarUpdatedAt)}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (
                        me.data?.displayName?.[0] ??
                        me.data?.email?.[0] ??
                        'П'
                      ).toLocaleUpperCase('ru-RU')
                    )}
                  </span>
                  <span
                    className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}
                  >
                    <span className="block text-xs font-semibold text-foreground">
                      {me.data?.displayName || 'Профиль'}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {me.data?.email ?? 'Аккаунт читателя'}
                    </span>
                  </span>
                  <UserRound
                    size={16}
                    className={`${collapsed ? 'md:hidden' : ''} text-muted`}
                    aria-hidden="true"
                  />
                  {collapsed && (
                    <span
                      className="sidebar-tooltip hidden md:block"
                      aria-hidden="true"
                    >
                      Профиль
                    </span>
                  )}
                </NavLink>
                <ThemeToggle compact={collapsed} />
              </footer>
            </aside>
          </>
        )}

        <main
          id="main"
          className={
            isReader
              ? 'w-full'
              : 'mx-auto w-full max-w-6xl px-5 py-8 md:px-10 md:py-12'
          }
        >
          <AppRoutes />
        </main>
      </div>
    </>
  )
}

function CurrentBook({
  book,
  loading,
  collapsed,
  onNavigate,
}: {
  book?: BookItem
  loading: boolean
  collapsed: boolean
  onNavigate: () => void
}) {
  const progress = book?.textLength
    ? Math.min(100, Math.round((book.positionOffset * 100) / book.textLength))
    : 0

  return (
    <section
      className={`mt-7 min-h-0 flex-1 overflow-y-auto ${collapsed ? 'md:overflow-visible' : ''}`}
    >
      <p
        className={`mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted ${collapsed ? 'md:hidden' : ''}`}
      >
        Читаю сейчас
      </p>
      <div className={collapsed ? 'md:hidden' : ''}>
        {loading ? (
          <div className="animate-pulse rounded-xl bg-subtle p-3">
            <div className="h-3 w-2/3 rounded bg-line" />
            <div className="mt-3 h-1.5 rounded bg-line" />
          </div>
        ) : book ? (
          <div className="rounded-2xl border border-line bg-page/70 p-3">
            <div className="flex gap-3">
              <div className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md bg-accent-soft">
                {book.hasCover ? (
                  <img
                    src={`/api/books/${encodeURIComponent(book.id)}/cover`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="grid h-full place-items-center text-accent">
                    <BookOpen size={19} aria-hidden="true" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs font-semibold leading-5">
                  {book.title}
                </p>
                <p className="mt-1 text-[11px] text-muted">{progress}%</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-teal-600"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
            <Link
              to={`/library/${book.id}/read`}
              className="mt-3 flex min-h-9 items-center justify-center rounded-xl bg-accent-soft px-3 text-xs font-semibold text-accent transition hover:bg-subtle"
              onClick={onNavigate}
            >
              Продолжить чтение
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
            Начните читать книгу — она появится здесь.
          </div>
        )}
      </div>

      {collapsed && book && (
        <Link
          to={`/library/${book.id}/read`}
          title={`${book.title} — ${progress}%`}
          aria-label={`Продолжить «${book.title}», прочитано ${progress}%`}
          className="sidebar-item mx-auto hidden w-12 overflow-hidden rounded-xl border border-line bg-page p-1 transition hover:border-accent-line md:block"
        >
          <span className="block aspect-[2/3] overflow-hidden rounded-lg bg-accent-soft">
            {book.hasCover ? (
              <img
                src={`/api/books/${encodeURIComponent(book.id)}/cover`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="grid h-full place-items-center text-accent">
                <BookOpen size={18} aria-hidden="true" />
              </span>
            )}
          </span>
          <span className="mt-1 block text-center text-[10px] font-semibold text-accent">
            {progress}%
          </span>
          <span className="sidebar-tooltip" aria-hidden="true">
            {book.title} · {progress}%
          </span>
        </Link>
      )}
    </section>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <EditorPage />
          </RequireAuth>
        }
      />
      <Route
        path="/library"
        element={
          <RequireAuth>
            <LibraryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/library/:id/read"
        element={
          <RequireAuth>
            <ReaderPage />
          </RequireAuth>
        }
      />
      <Route
        path="/library/:id/contexts"
        element={
          <RequireAuth>
            <BookContextPage />
          </RequireAuth>
        }
      />
      <Route
        path="/documents"
        element={
          <RequireAuth>
            <DocumentsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/documents/:id"
        element={
          <RequireAuth>
            <DocumentPage />
          </RequireAuth>
        }
      />
      <Route path="/history" element={<Navigate to="/documents" replace />} />
      <Route path="/history/:id" element={<LegacyDocumentRedirect />} />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="*"
        element={
          <div>
            <h1 className="text-2xl font-semibold">Страница не найдена</h1>
            <Link className="mt-4 block text-accent underline" to="/">
              Вернуться к новому тексту
            </Link>
          </div>
        }
      />
    </Routes>
  )
}

function LegacyDocumentRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/documents/${encodeURIComponent(id)}`} replace />
}
