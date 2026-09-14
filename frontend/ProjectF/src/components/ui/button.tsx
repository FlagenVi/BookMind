import type { ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

const variants = cva(
  'ui-button inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'ui-button-primary bg-teal-700 text-white',
        outline:
          'ui-button-outline border border-line bg-surface text-secondary',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      className={twMerge(clsx(variants({ variant }), className))}
      {...props}
    />
  )
}
