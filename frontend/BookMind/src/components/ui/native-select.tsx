import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type OptionHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  containerClassName?: string
}

type Option = {
  value: string
  label: ReactNode
  text: string
  disabled: boolean
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children)
  return ''
}

// Reads the <option> children, including ones inside fragments, conditionals and <optgroup>.
function collectOptions(children: ReactNode, result: Option[] = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return
    if (child.type === Fragment || child.type === 'optgroup') {
      collectOptions(child.props.children, result)
    } else if (child.type === 'option') {
      const props = child.props as OptionHTMLAttributes<HTMLOptionElement>
      result.push({
        value: String(props.value ?? textOf(props.children)),
        label: props.children,
        text: textOf(props.children),
        disabled: !!props.disabled,
      })
    }
  })
  return result
}

type Position = {
  target: HTMLElement
  style: CSSProperties
  placement: 'below' | 'above'
}

const GAP = 6
const MARGIN = 8

function measure(button: HTMLElement, optionCount: number): Position {
  const rect = button.getBoundingClientRect()
  const desired = Math.min(320, optionCount * 40 + 12)
  const below = window.innerHeight - rect.bottom - GAP - MARGIN
  const above = rect.top - GAP - MARGIN
  const placement = below >= desired || below >= above ? 'below' : 'above'
  const width = Math.min(
    Math.max(rect.width, 200),
    window.innerWidth - MARGIN * 2,
  )
  const left = Math.min(
    Math.max(MARGIN, rect.left),
    window.innerWidth - width - MARGIN,
  )
  return {
    // Inside the reader the list must inherit the reader's own theme variables.
    target: button.closest<HTMLElement>('.reader-shell') ?? document.body,
    placement,
    style: {
      left,
      width,
      maxHeight: Math.max(120, placement === 'below' ? below : above),
      ...(placement === 'below'
        ? { top: rect.bottom + GAP }
        : { bottom: window.innerHeight - rect.top + GAP }),
    },
  }
}

/**
 * A styled replacement for <select> with the same props and <option> children,
 * so existing forms keep working. The list is rendered in a portal, so it is never
 * clipped by scrolling dialogs, and stays inside the reader to inherit its theme.
 */
export function NativeSelect({
  className,
  containerClassName,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  id,
  title,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: NativeSelectProps) {
  const options = collectOptions(children)
  const [internal, setInternal] = useState(() =>
    String(defaultValue ?? options[0]?.value ?? ''),
  )
  const current = value !== undefined ? String(value) : internal
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === current),
  )
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(selectedIndex)
  const [position, setPosition] = useState<Position | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef({ text: '', at: 0 })
  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`

  const commit = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    setOpen(false)
    if (option.value === current) return
    if (value === undefined) setInternal(option.value)
    // Call sites read event.target.value, exactly as with a native select.
    onChange?.({
      target: { value: option.value },
      currentTarget: { value: option.value },
    } as unknown as ChangeEvent<HTMLSelectElement>)
  }

  const step = (from: number, direction: 1 | -1) => {
    for (
      let index = from + direction;
      index >= 0 && index < options.length;
      index += direction
    )
      if (!options[index].disabled) return index
    return from
  }

  const openList = () => {
    if (disabled || !options.length) return
    setActive(selectedIndex)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const update = () => {
      if (buttonRef.current)
        setPosition(measure(buttonRef.current, options.length))
    }
    update()
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return
      update()
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !buttonRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      )
        setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active, position])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((index) => step(index, 1)),
      ArrowUp: () => setActive((index) => step(index, -1)),
      Home: () => setActive(step(-1, 1)),
      End: () => setActive(step(options.length, -1)),
      Enter: () => commit(active),
      ' ': () => commit(active),
      Escape: () => setOpen(false),
    }
    if (keys[event.key]) {
      event.preventDefault()
      // Escape closes only the list, not the dialog that contains it.
      event.stopPropagation()
      keys[event.key]()
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = Date.now()
      const search = (
        now - typeahead.current.at < 600
          ? typeahead.current.text + event.key
          : event.key
      ).toLocaleLowerCase('ru-RU')
      typeahead.current = { text: search, at: now }
      const match = options.findIndex(
        (option) =>
          !option.disabled &&
          option.text.toLocaleLowerCase('ru-RU').startsWith(search),
      )
      if (match >= 0) setActive(match)
    }
  }

  return (
    <span
      className={twMerge(
        clsx('ui-select relative inline-grid min-w-0', containerClassName),
      )}
      data-open={open || undefined}
    >
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        title={title}
        disabled={disabled}
        className={twMerge(
          clsx('ui-select-control appearance-none text-left', className),
        )}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {/* Every label shares one grid cell, so the width fits the longest option like a native select. */}
        <span className="grid">
          {options.map((option, index) => (
            <span
              key={index}
              aria-hidden={index !== selectedIndex}
              className={`col-start-1 row-start-1 truncate ${index === selectedIndex ? '' : 'invisible'}`}
            >
              {option.label}
            </span>
          ))}
        </span>
      </button>
      <ChevronDown
        aria-hidden="true"
        className="ui-select-icon pointer-events-none absolute end-3 top-1/2"
        size={16}
        strokeWidth={2.25}
      />
      {open &&
        position &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={ariaLabelledBy}
            aria-label={ariaLabelledBy ? undefined : ariaLabel}
            data-placement={position.placement}
            className="ui-listbox project-scrollbar fixed z-[80] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-foreground shadow-2xl"
            style={position.style}
          >
            {options.map((option, index) => {
              const selected = index === selectedIndex
              return (
                <li
                  key={index}
                  id={optionId(index)}
                  data-index={index}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${index === active ? 'bg-accent-soft text-accent' : ''} ${selected ? 'font-semibold' : ''} ${option.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
                  onPointerMove={() => !option.disabled && setActive(index)}
                  // Keeps focus on the button, which owns the keyboard handling.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    commit(index)
                    buttonRef.current?.focus()
                  }}
                >
                  <span className="min-w-0 flex-1">{option.label}</span>
                  {selected && (
                    <Check
                      size={16}
                      className="shrink-0 text-accent"
                      aria-hidden="true"
                    />
                  )}
                </li>
              )
            })}
          </ul>,
          position.target,
        )}
    </span>
  )
}
