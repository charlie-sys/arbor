
Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('设置'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
function measure() {
  const main = document.querySelector('.main-area')
  const sidebar = document.querySelector('.sidebar-host')
  const grid = document.querySelector('.settings-grid')
  return {
    viewport: window.innerWidth,
    main: main ? Math.round(main.getBoundingClientRect().width) : null,
    sidebar: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
    grid: grid ? Math.round(grid.getBoundingClientRect().width) : null,
    scrollWidth: document.documentElement.scrollWidth
  }
}
const before = measure()
window.resizeTo(1400, 900)
await new Promise((resolve) => setTimeout(resolve, 800))
const after = measure()
return { before, after, storedRatio: window.localStorage.getItem('zotagent-sidebar-ratio') }
