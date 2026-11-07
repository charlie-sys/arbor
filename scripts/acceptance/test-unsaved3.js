
Array.from(document.querySelectorAll('button')).find(b=>b.title==='表格视图')?.click()
await new Promise(r=>setTimeout(r,300))
Array.from(document.querySelectorAll('.cell-title-text')).find(el=>el.innerText.includes('未保存保护测试'))?.click()
await new Promise(r=>setTimeout(r,1500))
Array.from(document.querySelectorAll('.panel-tab')).find(el=>el.innerText.trim().startsWith('笔记'))?.click()
await new Promise(r=>setTimeout(r,300))
Array.from(document.querySelectorAll('.notes-panel button')).find(b=>b.innerText.trim()==='编辑')?.click()
await new Promise(r=>setTimeout(r,300))
const ta=document.querySelector('.notes-editor')
if(ta){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(ta,'未保存内容');ta.dispatchEvent(new Event('input',{bubbles:true}))}
await new Promise(r=>setTimeout(r,400))
const back=Array.from(document.querySelectorAll('.reader-toolbar button')).find(b=>b.title==='返回文献库')
back?.click()
await new Promise(r=>setTimeout(r,600))
return {activeReader:Boolean(document.querySelector('.view-slot.active .reader-view')), activeLibrary:Boolean(document.querySelector('.view-slot.active .library-view')), toast:document.body.innerText.includes('有未保存的修改')}
