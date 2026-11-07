
const btn=Array.from(document.querySelectorAll('.inbox-editor-modal button')).find(b=>b.title==='全屏编辑')
btn?.click()
await new Promise(r=>setTimeout(r,500))
const modal=document.querySelector('.inbox-editor-modal'); const grid=document.querySelector('.inbox-editor-grid')
return {fullscreen:modal?.classList.contains('fullscreen'), modalWidth:Math.round(modal.getBoundingClientRect().width), gridWidth:Math.round(grid.getBoundingClientRect().width), cols:getComputedStyle(grid).gridTemplateColumns, split:grid.style.getPropertyValue('--editor-split')}
