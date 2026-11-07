
const save=Array.from(document.querySelectorAll('.notes-panel button')).find(b=>b.innerText.includes('保存笔记'))
save?.click()
await new Promise(r=>setTimeout(r,1200))
const back=Array.from(document.querySelectorAll('.reader-toolbar button')).find(b=>b.title==='返回文献库')
back?.click()
await new Promise(r=>setTimeout(r,800))
return {activeReader:Boolean(document.querySelector('.view-slot.active .reader-view')), activeLibrary:Boolean(document.querySelector('.view-slot.active .library-view')), toast:document.body.innerText.includes('有未保存的修改')}
