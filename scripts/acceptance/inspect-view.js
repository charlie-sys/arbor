
return {activeNav: document.querySelector('.nav-item.active')?.innerText, activeSlot: document.querySelector('.view-slot.active')?.className, slots: Array.from(document.querySelectorAll('.view-slot')).map(el=>el.className), bodyText: document.body.innerText.slice(0,120)}
