const spans = Array.from(document.querySelectorAll('.textLayer span')).map((span) => span.innerText.trim()).filter(Boolean)
return { count: spans.length, sample: spans.slice(0, 20) }
