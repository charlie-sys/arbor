(() => {
  const root = document.documentElement
  const themeKey = 'arbor-site-theme'
  const toggle = document.getElementById('themeToggle')

  const applyTheme = (theme) => {
    root.dataset.theme = theme
    if (toggle) {
      toggle.innerHTML =
        theme === 'dark'
          ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/></svg>'
          : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>'
      toggle.setAttribute('title', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式')
      toggle.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式')
    }
  }

  let theme = localStorage.getItem(themeKey)
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  applyTheme(theme)

  toggle?.addEventListener('click', () => {
    theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(themeKey, theme)
    applyTheme(theme)
  })

  const year = document.getElementById('year')
  if (year) year.textContent = String(new Date().getFullYear())

  const repoBase = (() => {
    const host = location.hostname
    if (!host.endsWith('github.io')) return 'https://github.com/'
    const owner = host.split('.')[0]
    const repo = location.pathname.split('/').filter(Boolean)[0]
    return repo ? `https://github.com/${owner}/${repo}` : 'https://github.com/'
  })()

  document.querySelectorAll('[data-github]').forEach((link) => {
    link.href = repoBase
  })
  document.querySelectorAll('[data-download]').forEach((link) => {
    link.href = `${repoBase}/releases/latest`
  })

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
          observer.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.12 }
  )
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element))

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const id = link.getAttribute('href')
      if (!id || id === '#') return
      const target = document.querySelector(id)
      if (!target) return
      event.preventDefault()
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
})()
