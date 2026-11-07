
const modal=document.querySelector('.inbox-editor-modal'); const backdrop=document.querySelector('.modal-backdrop'); const s=getComputedStyle(modal); const b=getComputedStyle(backdrop);
return {display:s.display, visibility:s.visibility, width:s.width, height:s.height, maxWidth:s.maxWidth, maxHeight:s.maxHeight, position:s.position, opacity:s.opacity, backdropDisplay:b.display, backdropW:backdrop?.getBoundingClientRect().width, backdropH:backdrop?.getBoundingClientRect().height}
