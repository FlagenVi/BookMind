// Apply before the app renders to avoid a flash of the wrong theme.
;(() => {
  let theme
  try {
    theme = localStorage.getItem('text-app-theme')
  } catch {
    /* Storage may be unavailable. */
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
})()
