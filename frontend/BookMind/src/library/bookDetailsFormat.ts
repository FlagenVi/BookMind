export function languageDisplayName(value: string | null) {
  if (!value) return 'Не указано'
  const code = value.trim()
  if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(code)) return value
  try {
    if (typeof Intl.DisplayNames !== 'function') return value
    const normalized = code.replaceAll('_', '-')
    const name = new Intl.DisplayNames('ru-RU', { type: 'language' }).of(
      normalized,
    )
    if (!name || name.toLocaleLowerCase('ru-RU') === normalized.toLowerCase())
      return value
    return name.charAt(0).toLocaleUpperCase('ru-RU') + name.slice(1)
  } catch {
    return value
  }
}
