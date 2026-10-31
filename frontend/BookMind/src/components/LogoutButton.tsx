import { LogOut } from 'lucide-react'
import { Button } from './ui/button'
import { useLogout } from './useLogout'

export function LogoutButton({ compact }: { compact: boolean }) {
  const logout = useLogout()
  const label = logout.isError
    ? 'Не удалось выйти, повторите'
    : logout.isPending
      ? 'Выходим…'
      : 'Выйти из аккаунта'
  return (
    <Button
      variant="outline"
      className="logout-button sidebar-item min-h-11 shrink-0 px-3"
      aria-label={label}
      title={compact ? undefined : label}
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
    >
      <LogOut size={18} aria-hidden="true" />
      {compact && (
        <span className="sidebar-tooltip hidden md:block" aria-hidden="true">
          {label}
        </span>
      )}
    </Button>
  )
}
