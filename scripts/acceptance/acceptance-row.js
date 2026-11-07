const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) => tr.innerText.includes('Alpha 文献'))
return { html: row ? row.outerHTML.slice(0, 1800) : null }
