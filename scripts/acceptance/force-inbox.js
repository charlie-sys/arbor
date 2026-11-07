
const edge=document.querySelector('.sidebar-edge')
if (edge) { edge.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); edge.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); }
await new Promise(r=>setTimeout(r,500))
const nav=Array.from(document.querySelectorAll('.nav-item')).find(b=>b.innerText.includes('Inbox'))
nav?.click()
await new Promise(r=>setTimeout(r,700))
return {found:Boolean(nav), active:document.querySelector('.nav-item.active')?.innerText, inboxSlot:Array.from(document.querySelectorAll('.view-slot')).findIndex(el=>el.className.includes('active'))}
