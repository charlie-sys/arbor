
const close=Array.from(document.querySelectorAll('.inbox-editor-modal .icon-btn')).find(b=>b.title==='关闭')
close?.click()
await new Promise(r=>setTimeout(r,400))
document.querySelector('.inbox-item')?.click()
await new Promise(r=>setTimeout(r,500))
return {modal:Boolean(document.querySelector('.inbox-editor-modal')), split:document.querySelector('.inbox-editor-grid')?.style.getPropertyValue('--editor-split'), cols: document.querySelector('.inbox-editor-grid')?getComputedStyle(document.querySelector('.inbox-editor-grid')).gridTemplateColumns:null}
