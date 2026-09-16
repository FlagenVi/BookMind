import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  containerClassName?: string
}

export function NativeSelect({
  className,
  containerClassName,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <span
      className={twMerge(
        clsx('ui-select relative inline-grid min-w-0', containerClassName),
      )}
    >
      <select
        className={twMerge(
          clsx('ui-select-control appearance-none', className),
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="ui-select-icon pointer-events-none absolute end-3 top-1/2"
        size={16}
        strokeWidth={2.25}
      />
    </span>
  )
}
