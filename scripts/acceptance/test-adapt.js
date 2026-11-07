
const sidebar = document.querySelector('.sidebar-host')
const before = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null
document.querySelector('.sidebar-hide')?.click()
await new Promise(r=>setTimeout(r,300))
const hidden = !document.querySelector('.sidebar-host') && Boolean(document.querySelector('.sidebar-reveal'))
document.querySelector('.sidebar-reveal')?.click()
await new Promise(r=>setTimeout(r,300))
const after = document.querySelector('.sidebar-host') ? Math.round(document.querySelector('.sidebar-host').getBoundingClientRect().width) : null
return { innerWidth, innerHeight, availWidth: screen.availWidth, availHeight: screen.availHeight, before, hidden, after, bodyScrollWidth: document.body.scrollWidth }
