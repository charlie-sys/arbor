
const divider=document.querySelector('.inbox-editor-divider'); const grid=document.querySelector('.inbox-editor-grid')
const rect=grid.getBoundingClientRect(); const y=rect.top+20
divider.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.left+rect.width*0.5,clientY:y,pointerId:1}))
window.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.left+rect.width*0.65,clientY:y,pointerId:1}))
window.dispatchEvent(new PointerEvent('pointerup',{clientX:rect.left+rect.width*0.65,clientY:y,pointerId:1}))
await new Promise(r=>setTimeout(r,300))
return {split:grid.style.getPropertyValue('--editor-split'), cols:getComputedStyle(grid).gridTemplateColumns, width:Math.round(rect.width)}
