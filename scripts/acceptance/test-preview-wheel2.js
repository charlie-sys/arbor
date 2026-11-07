
const preview=document.querySelector('.inbox-editor-preview')
const scaler=preview?.querySelector('.inbox-preview-scaler')
for(let i=0;i<5;i++){preview?.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,100))}
const afterZoom={scalerWidth:scaler?Math.round(scaler.getBoundingClientRect().width):null,previewClientWidth:preview?.clientWidth,previewScrollWidth:preview?.scrollWidth,scalerHeight:scaler?Math.round(scaler.getBoundingClientRect().height):null,previewClientHeight:preview?.clientHeight,previewScrollHeight:preview?.scrollHeight}
preview.scrollLeft=0
preview.dispatchEvent(new WheelEvent('wheel',{deltaY:200,shiftKey:true,bubbles:true,cancelable:true}))
await new Promise(r=>setTimeout(r,200))
const afterShift={scrollLeft:preview.scrollLeft}
return {afterZoom,afterShift,zoomLabel:document.querySelector('.inbox-zoom-controls .muted')?.innerText}
