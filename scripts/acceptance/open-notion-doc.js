
Array.from(document.querySelectorAll('button')).find(b=>b.title==='表格视图')?.click()
await new Promise(r=>setTimeout(r,300))
Array.from(document.querySelectorAll('.cell-title-text'))[0]?.click()
await new Promise(r=>setTimeout(r,1500))
return 'ok'
