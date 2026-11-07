const layers = Array.from(document.querySelectorAll('.pdf-highlight-layer')).map((layer, index) => ({
  index,
  children: layer.children.length,
  top: Math.round(layer.getBoundingClientRect().top),
  height: Math.round(layer.getBoundingClientRect().height)
}))
const marks = Array.from(document.querySelectorAll('.pdf-highlight')).map((mark) => {
  const rect = mark.getBoundingClientRect()
  return { cls: mark.className, top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
})
const spans = Array.from(document.querySelectorAll('.textLayer span')).map((span) => {
  const rect = span.getBoundingClientRect()
  return { text: span.innerText.trim(), top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
})
return { layers, marks, spans }
