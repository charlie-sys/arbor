const buttons = Array.from(document.querySelectorAll('button')).map((button) => ({
  text: button.innerText.trim().slice(0, 40),
  title: button.title,
  aria: button.getAttribute('aria-label'),
  cls: button.className
}))
const tabLists = Array.from(document.querySelectorAll('[role="tab"], .panel-tab')).map((el) => ({
  text: el.innerText.trim(),
  cls: el.className
}))
return { buttons, tabLists }
