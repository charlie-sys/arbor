
const shell = document.querySelector('.app-shell')
const main = document.querySelector('.main-area')
const rect = shell?.getBoundingClientRect()
return {
  innerWidth,
  innerHeight,
  outerWidth: window.outerWidth,
  outerHeight: window.outerHeight,
  availWidth: screen.availWidth,
  availHeight: screen.availHeight,
  shellWidth: rect ? Math.round(rect.width) : null,
  shellHeight: rect ? Math.round(rect.height) : null,
  mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight
}
