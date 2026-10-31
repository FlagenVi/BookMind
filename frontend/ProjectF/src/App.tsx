import { lazy, Suspense, useState } from 'react'
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
  Bell,
  FileText,
  Files,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { authApi } from './api/auth'
import { booksApi, type BookItem } from './api/books'
import { RequireAuth } from './components/RequireAuth'
import { ThemeToggle } from './components/ThemeToggle'
import { SocialRuntime } from './social/SocialRuntime'
import { useSocialUnread } from './social/useSocialUnread'

const AuthPage = lazy(() =>
  import('./pages/AuthPage').then(({ AuthPage }) => ({ default: AuthPage })),
)
const EditorPage = lazy(() =>
  import('./pages/EditorPage').then(({ EditorPage }) => ({
    default: EditorPage,
  })),
)
const DocumentsPage = lazy(() =>
  import('./pages/HistoryPage').then(({ DocumentsPage }) => ({
    default: DocumentsPage,
  })),
)
const DocumentPage = lazy(() =>
  import('./pages/HistoryPage').then(({ DocumentPage }) => ({
    default: DocumentPage,
  })),
)
const LibraryPage = lazy(() =>
  import('./pages/LibraryPage').then(({ LibraryPage }) => ({
    default: LibraryPage,
  })),
)
const NovelChaptersPage = lazy(() =>
  import('./pages/NovelChaptersPage').then(({ NovelChaptersPage }) => ({
    default: NovelChaptersPage,
  })),
)
const CommunicationPage = lazy(() =>
  import('./pages/CommunicationPage').then(({ CommunicationPage }) => ({
    default: CommunicationPage,
  })),
)
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then(({ ProfilePage }) => ({
    default: ProfilePage,
  })),
)
const PublicProfilePage = lazy(() =>
  import('./pages/PublicProfilePage').then(({ PublicProfilePage }) => ({
    default: PublicProfilePage,
  })),
)
const ReaderPage = lazy(() =>
  import('./pages/ReaderPage').then(({ ReaderPage }) => ({
    default: ReaderPage,
  })),
)
const CommunitiesPage = lazy(() =>
  import('./pages/SocialPages').then(({ CommunitiesPage }) => ({
    default: CommunitiesPage,
  })),
)
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then(({ NotificationsPage }) => ({
    default: NotificationsPage,
  })),
)

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
  { to: '/communication', title: 'Общение', Icon: MessageCircle },
  { to: '/communities', title: 'Сообщества', Icon: Users },
  { to: '/notifications', title: 'Уведомления', Icon: Bell },
]

const mobileNavigation: NavigationItem[] = [
  { to: '/library', title: 'Библиотека', Icon: BookOpen },
  { to: '/documents', title: 'Документы', Icon: Files },
  { to: '/communication', title: 'Общение', Icon: MessageCircle },
  { to: '/communities', title: 'Сообщества', Icon: Users },
  { to: '/profile', title: 'Профиль', Icon: UserRound },
]

function mobilePageTitle(pathname: string) {
  if (pathname.startsWith('/library')) return 'Библиотека'
  if (pathname.startsWith('/documents')) return 'Документы'
  if (pathname.startsWith('/communication')) return 'Общение'
  if (pathname.startsWith('/people/')) return 'Читатель'
  if (pathname.startsWith('/communities')) return 'Сообщества'
  if (pathname.startsWith('/notifications')) return 'Уведомления'
  if (pathname.startsWith('/profile')) return 'Профиль'
  return 'Новый материал'
}

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
  const isPublicProfile = /^\/people\/[^/]+\/?$/.test(location.pathname)
  const hasSidebar = !isReader && !isAuth && !isPublicProfile
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
  const unread = useSocialUnread(!!me.data)
  const badgeFor = (to: string) =>
    to === '/communication'
      ? (unread.data?.messages ?? 0)
      : to === '/notifications'
        ? (unread.data?.notifications ?? 0)
        : 0

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
      {me.data && <SocialRuntime key={me.data.id} userId={me.data.id} />}
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
            <header className="mobile-app-header sticky top-0 z-30 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center border-b border-line bg-surface/95 px-3 pb-2 pt-2 backdrop-blur md:hidden">
              <Link
                to="/library"
                className="brand-link grid size-11 place-items-center rounded-xl text-white"
                aria-label="BookMind — библиотека"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-primary">
                  <FileText size={19} aria-hidden="true" />
                </span>
              </Link>
              <div className="min-w-0 px-2 text-center">
                <p className="truncate text-sm font-semibold">
                  {mobilePageTitle(location.pathname)}
                </p>
                <p className="truncate text-[10px] font-medium text-muted">
                  BookMind
                </p>
              </div>
              <Link
                to="/notifications"
                className={`relative grid size-11 place-items-center rounded-xl border transition ${location.pathname.startsWith('/notifications') ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-secondary'}`}
                aria-label="Уведомления"
              >
                <Bell size={20} aria-hidden="true" />
                {badgeFor('/notifications') > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">
                    {Math.min(99, badgeFor('/notifications'))}
                    <span className="sr-only"> непрочитанных уведомлений</span>
                  </span>
                )}
              </Link>
            </header>

            <aside
              id="app-sidebar"
              className={`sticky top-0 z-20 hidden h-screen flex-col overflow-visible border-r border-line bg-surface shadow-none transition-[padding] duration-300 md:flex ${collapsed ? 'sidebar-collapsed p-3' : 'p-5'}`}
            >
              <div
                className={`relative flex shrink-0 items-center gap-2 ${collapsed ? 'md:flex-col' : ''}`}
              >
                <Link
                  to="/library"
                  title={collapsed ? 'BookMind' : undefined}
                  className={`brand-link flex min-w-0 flex-1 items-center gap-3 rounded-xl font-bold tracking-tight ${collapsed ? 'md:justify-center' : ''}`}
                >
                  <span className="shrink-0 rounded-xl bg-primary p-2 text-white">
                    <FileText size={21} aria-hidden="true" />
                  </span>
                  <span
                    className={`truncate text-lg ${collapsed ? 'md:hidden' : ''}`}
                  >
                    BookMind
                  </span>
                </Link>
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
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className={collapsed ? 'md:hidden' : ''}>
                      {title}
                    </span>
                    {badgeFor(to) > 0 && (
                      <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {badgeFor(to) > 99 ? '99+' : badgeFor(to)}
                        <span className="sr-only"> непрочитанных</span>
                      </span>
                    )}
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
                onNavigate={() => undefined}
              />

              <footer className="mt-auto shrink-0 border-t border-line pt-3">
                <NavLink
                  to="/profile"
                  title={collapsed ? 'Профиль' : undefined}
                  className={({ isActive }) =>
                    `nav-link sidebar-item flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 text-sm ${collapsed ? 'md:justify-center md:px-0' : ''} ${isActive ? 'bg-accent-soft text-accent' : 'text-secondary'}`
                  }
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

            <nav
              aria-label="Мобильная навигация"
              className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 px-1 pt-1 backdrop-blur md:hidden"
            >
              {mobileNavigation.map(({ to, title, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-medium transition ${isActive ? 'bg-accent-soft text-accent' : 'text-muted'}`
                  }
                >
                  <span className="relative">
                    <Icon size={20} aria-hidden="true" />
                    {badgeFor(to) > 0 && (
                      <span className="absolute -right-3 -top-1 rounded-full bg-primary px-1 text-[9px] font-semibold text-white">
                        {badgeFor(to) > 99 ? '99+' : badgeFor(to)}
                        <span className="sr-only"> непрочитанных</span>
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center">{title}</span>
                </NavLink>
              ))}
            </nav>
          </>
        )}

        <main
          id="main"
          className={
            isReader
              ? 'w-full'
              : `${hasSidebar ? 'mobile-main-safe' : ''} mx-auto w-full max-w-6xl px-4 py-6 sm:px-5 sm:py-8 md:px-10 md:py-12`
          }
        >
          <Suspense
            fallback={
              <div
                className={`grid place-items-center text-sm text-muted ${isReader ? 'min-h-dvh' : 'min-h-[40vh]'}`}
                role="status"
              >
                Открываем страницу…
              </div>
            }
          >
            <AppRoutes />
          </Suspense>
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
                    className="h-full rounded-full bg-primary"
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
        path="/library/novels/new"
        element={
          <RequireAuth>
            <NovelChaptersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/library/:id/chapters"
        element={
          <RequireAuth>
            <NovelChaptersPage />
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
            <LegacyBookContextRedirect />
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
      <Route
        path="/communication"
        element={
          <RequireAuth>
            <CommunicationPage />
          </RequireAuth>
        }
      />
      <Route path="/people/:username" element={<PublicProfilePage />} />
      <Route
        path="/communities"
        element={
          <RequireAuth>
            <CommunitiesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <NotificationsPage />
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

function LegacyBookContextRedirect() {
  const { id = '' } = useParams()
  return (
    <Navigate
      to={`/library/${encodeURIComponent(id)}/read?panel=book&tab=summary`}
      replace
    />
  )
}
