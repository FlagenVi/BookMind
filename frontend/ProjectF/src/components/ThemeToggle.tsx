import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'

type Theme = 'light' | 'dark'
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  useEffect(() => {
    const apply = (value: Theme) => {
      document.documentElement.dataset.theme = value
      document.documentElement.style.colorScheme = value
      setTheme(value)
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const systemChange = () => {
      try {
        const saved = localStorage.getItem('text-app-theme')
        if (saved === 'light' || saved === 'dark') return
      } catch {
        /* Keep the switch usable without storage. */
      }
      apply(media.matches ? 'dark' : 'light')
    }
    const storageChange = (event: StorageEvent) => {
      if (event.key === 'text-app-theme' || event.key === null)
        apply(
          event.newValue === 'light' || event.newValue === 'dark'
            ? event.newValue
            : media.matches
              ? 'dark'
              : 'light',
        )
    }
    media.addEventListener('change', systemChange)
    window.addEventListener('storage', storageChange)
    return () => {
      media.removeEventListener('change', systemChange)
      window.removeEventListener('storage', storageChange)
    }
  }, [])
  const dark = theme === 'dark'
  return (
    <Button
      variant="outline"
      className={`sidebar-item mt-2 min-h-11 w-full justify-start ${compact ? 'md:justify-center md:px-0' : ''}`}
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={compact ? (dark ? 'Светлая тема' : 'Тёмная тема') : undefined}
      onClick={() => {
        const next = dark ? 'light' : 'dark'
        document.documentElement.dataset.theme = next
        document.documentElement.style.colorScheme = next
        setTheme(next)
        try {
          localStorage.setItem('text-app-theme', next)
        } catch {
          /* Theme still works in this tab. */
        }
      }}
    >
      {dark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
      <span className={compact ? 'md:hidden' : ''}>
        {dark ? 'Светлая тема' : 'Тёмная тема'}
      </span>
      {compact && (
        <span className="sidebar-tooltip hidden md:block" aria-hidden="true">
          {dark ? 'Светлая тема' : 'Тёмная тема'}
        </span>
      )}
    </Button>
  )
}
