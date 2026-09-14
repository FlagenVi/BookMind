import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookOpen, FileText, History, Plus, UserRound } from 'lucide-react'
import { EditorPage } from './pages/EditorPage'
import { HistoryPage, DocumentPage } from './pages/HistoryPage'
import { AuthPage } from './pages/AuthPage'
import { ProfilePage } from './pages/ProfilePage'
import { LibraryPage } from './pages/LibraryPage'
import { ReaderPage } from './pages/ReaderPage'
import { RequireAuth } from './components/RequireAuth'
import { ThemeToggle } from './components/ThemeToggle'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30000 } },
})
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
  const isReader = /^\/library\/[^/]+\/read\/?$/.test(useLocation().pathname)
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only">
        Перейти к содержимому
      </a>
      <div
        className={
          isReader
            ? 'min-h-screen'
            : 'min-h-screen md:grid md:grid-cols-[240px_1fr]'
        }
      >
        {!isReader && (
          <aside className="border-b border-line bg-surface p-5 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:p-6">
            <Link
              to="/"
              className="brand-link flex items-center gap-3 rounded-xl text-xl font-bold tracking-tight"
            >
              <span className="rounded-xl bg-teal-700 p-2 text-white">
                <FileText size={22} />
              </span>
              Суть текста
            </Link>
            <p className="mt-2 text-xs text-muted">
              Платформа сжатого изложения
            </p>
            <nav
              aria-label="Основная навигация"
              className="mt-7 flex gap-1 overflow-x-auto md:flex-col"
            >
              {[
                { to: '/', title: 'Новый текст', Icon: Plus },
                { to: '/library', title: 'Библиотека', Icon: BookOpen },
                { to: '/history', title: 'История', Icon: History },
                { to: '/profile', title: 'Профиль', Icon: UserRound },
              ].map(({ to, title, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `nav-link flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-3 text-sm font-medium ${isActive ? 'bg-accent-soft text-accent' : 'text-secondary'}`
                  }
                >
                  <Icon size={18} />
                  {title}
                </NavLink>
              ))}
            </nav>
            <ThemeToggle />
            <div className="mt-10 hidden rounded-xl bg-page p-4 text-xs leading-5 text-muted md:block">
              Рабочее пространство для ваших текстов и кратких изложений.
            </div>
          </aside>
        )}
        <main
          id="main"
          className={
            isReader
              ? 'w-full'
              : 'mx-auto w-full max-w-6xl px-5 py-8 md:px-10 md:py-12'
          }
        >
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
              path="/history"
              element={
                <RequireAuth>
                  <HistoryPage />
                </RequireAuth>
              }
            />
            <Route
              path="/history/:id"
              element={
                <RequireAuth>
                  <DocumentPage />
                </RequireAuth>
              }
            />
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
                  <h1 className="text-2xl font-semibold">
                    Страница не найдена
                  </h1>
                  <Link className="mt-4 block text-accent underline" to="/">
                    Вернуться к новому тексту
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </>
  )
}
