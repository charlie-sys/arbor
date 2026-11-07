
const grid=document.querySelector('.inbox-editor-grid'); const d=document.querySelector('.inbox-editor-divider');
const r=grid?.getBoundingClientRect();
return {gridWidth:r?.width, label:grid?.style.getPropertyValue('--editor-split'), divider: d? {left:d.getBoundingClientRect().left,width:d.getBoundingClientRect().width}:null, fullscreen: document.querySelector('.inbox-editor-modal')?.className}
