const state = await window.api.library.getState()
return {
  savedViews: state.savedViews,
  viewButtons: Array.from(document.querySelectorAll('button'))
    .filter((button) => button.title === '卡片视图' || button.title === '表格视图')
    .map((button) => ({ title: button.title, active: button.className.includes('active') })),
  hasTable: Boolean(document.querySelector('table')),
  statusValue: Array.from(document.querySelectorAll('select')).find((select) => select.options[0]?.text === '全部阅读状态')?.value ?? null,
  body: document.body.innerText.slice(0, 700)
}
