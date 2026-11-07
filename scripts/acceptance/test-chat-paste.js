
const textarea=document.querySelector('.chat-thread-slot.active .composer textarea')
const transfer=new DataTransfer()
const bytes=new Uint8Array([137,80,78,71,13,10,26,10])
transfer.items.add(new File([bytes],'pasted.png',{type:'image/png'}))
const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true})
textarea?.dispatchEvent(event)
await new Promise(r=>setTimeout(r,900))
return {pastedChips:Array.from(document.querySelectorAll('.chat-thread-slot.active .chat-attachment')).map(el=>el.innerText.trim()), images:document.querySelectorAll('.chat-thread-slot.active .chat-attachment img').length}
