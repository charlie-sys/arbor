
const modal=document.querySelector('.inbox-editor-modal'); const body=document.querySelector('.inbox-editor-body'); const grid=document.querySelector('.inbox-editor-grid'); const ta=document.querySelector('.inbox-editor-grid textarea'); const pv=document.querySelector('.inbox-editor-preview');
function r(el){const b=el?.getBoundingClientRect();return b?{w:Math.round(b.width),h:Math.round(b.height),left:Math.round(b.left)}:null}
return {modal:r(modal),body:r(body),grid:r(grid),ta:r(ta),pv:r(pv), bodyDisplay: body?getComputedStyle(body).display:null, gridCols: grid?getComputedStyle(grid).gridTemplateColumns:null, modalClass:modal?.className}
