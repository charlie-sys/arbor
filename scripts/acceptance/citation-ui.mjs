import assert from 'node:assert/strict'

export async function testCitationIndicator({ evaluate, waitFor, pdfDoc, textPath, capture }) {
  const marker = '.reference-page-indicator'
  const fixture = await evaluate(`(async () => {
    const doc = await window.api.library.importDocument(${JSON.stringify(textPath)}, 'Citation text fixture');
    await window.api.library.setText(doc.id, ['Text first page', 'Text second page']);
    const chat = await window.api.chats.create([${JSON.stringify(pdfDoc.id)}, doc.id]);
    await window.api.chats.update(chat.id, {title:'Citation indicator fixture', messages:[{
      id:'citation-answer', role:'assistant', createdAt:Date.now(), content:'《PDF multi-window test》第2页；《Citation text fixture》第2页'
    }]});
    return {doc,chat};
  })()`)
  await waitFor(() => evaluate('!!document.querySelector(".reader-panel .page-ref")'))
  await evaluate('document.querySelector(".reader-panel .page-ref").click()')
  await waitFor(() => evaluate(`document.querySelector('${marker}')?.dataset.referencePage === '2'`))
  assert.equal(await evaluate(`document.querySelector('${marker}').closest('.page').dataset.pageNumber`), '2')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${marker}')).pointerEvents`), 'none')
  assert(await evaluate(`document.querySelector('${marker}').textContent.includes('引用位置')`))
  await capture('citation-pdf')
  await evaluate(`window.__oldMarker = document.querySelector('${marker}'); document.querySelector('.reader-panel .page-ref').click()`)
  await waitFor(() => evaluate(`document.querySelector('${marker}') && document.querySelector('${marker}') !== window.__oldMarker`))
  console.log('PASS: PDF answer links show a labeled cue on the rendered target page; same-page clicks restart it')

  await evaluate(`window.api.readerPanel.open(${JSON.stringify(pdfDoc.id)}, 'agent', ${JSON.stringify(fixture.chat.id)})`)
  await evaluate(`window.api.readerPanel.openDoc(${JSON.stringify(pdfDoc.id)}, 2)`)
  await waitFor(() => evaluate(`document.querySelector('${marker}')?.dataset.referencePage === '2'`))
  await evaluate(`window.__oldMarker = document.querySelector('${marker}'); window.api.readerPanel.openDoc(${JSON.stringify(pdfDoc.id)}, 2)`)
  await waitFor(() => evaluate(`document.querySelector('${marker}') && document.querySelector('${marker}') !== window.__oldMarker`))
  await evaluate('window.api.readerPanel.close()')
  await waitFor(() => evaluate('!!document.querySelector(".reader-panel .page-ref")'))
  console.log('PASS: repeated detached-panel navigation to an unchanged page restarts the cue')

  await evaluate(`(() => {
    document.querySelector('.citation-toggle').click();
  })()`)
  await waitFor(() => evaluate('!!document.querySelector(".citation-item")'))
  await evaluate(`window.__oldMarker = document.querySelector('${marker}'); document.querySelector('.citation-item').click()`)
  await waitFor(() => evaluate(`document.querySelector('${marker}') && document.querySelector('${marker}') !== window.__oldMarker`))
  console.log('PASS: citation source list uses the same navigation cue')

  await evaluate(`document.querySelectorAll('.reader-panel .page-ref')[1].click()`)
  await waitFor(() => evaluate(`document.querySelector('.text-doc-sheet ${marker}')?.dataset.referencePage === '2'`))
  assert(await evaluate('document.querySelector(".text-doc-content").textContent.includes("Text second page")'))
  await capture('citation-text')
  await evaluate(`window.__oldMarker = document.querySelector('${marker}'); document.querySelectorAll('.reader-panel .page-ref')[1].click()`)
  await waitFor(() => evaluate(`document.querySelector('${marker}') && document.querySelector('${marker}') !== window.__oldMarker`))
  await waitFor(() => evaluate(`!document.querySelector('${marker}')`))
  assert.equal(await evaluate(`window.api.highlights.list(${JSON.stringify(fixture.doc.id)}).then(list => list.length)`), 0)
  console.log('PASS: cross-document text citations indicate after content loads, repeat on the same page and clear without saved highlights')
}
