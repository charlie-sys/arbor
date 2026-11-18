import assert from 'node:assert/strict'

export async function testUnsavedNavigation({ evaluate, waitFor }) {
  const original = await evaluate('window.api.library.getState().then(s => s.documents[0])')
  const folders = await evaluate(`(async () => {
    const a = await window.api.collections.add('Navigation A');
    const b = await window.api.collections.add('Navigation B');
    return [a.id, b.id];
  })()`)
  await evaluate('document.querySelector("button[title=\\"返回文献库\\"]").click()')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .library-view")'))
  await evaluate(`window.api.library.update(${JSON.stringify(original.id)}, {tags:['Saved external tag'],collections:[${JSON.stringify(folders[0])}]})`)
  await waitFor(() => evaluate('[...document.querySelectorAll(".doc-row")].some(row => row.textContent.includes("Saved external tag"))'))
  await evaluate(`document.querySelector('.library-folder-panel [data-folder-id="${folders[0]}"]').click()`)
  assert.equal(await evaluate(`document.querySelector('.library-folder-panel [data-folder-id="${folders[0]}"]').getAttribute('aria-selected')`), 'true',
    'Saved changes to a hidden reader must not be mistaken for an unsaved draft and block switching folders')
  await evaluate('document.querySelector(".doc-row").click()')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .reader-view")'))
  await evaluate('document.querySelector(".reader-panel button[title=\\"文献信息\\"]").click()')
  await waitFor(() => evaluate('!!document.querySelector(".info-panel input")'))
  await evaluate(`(() => {
    const node = document.querySelector('.info-panel input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node, '  Preserved draft title  ');
    node.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await evaluate(`window.api.library.update(${JSON.stringify(original.id)}, {authors:'Synced author'})`)
  await waitFor(() => evaluate('document.querySelectorAll(".info-panel input")[1].value === "Synced author"'))
  assert.equal(await evaluate('document.querySelector(".info-panel input").value'), '  Preserved draft title  ')
  await evaluate('document.querySelector("button[title=\\"返回文献库\\"]").click()')
  assert.equal(await evaluate('!!document.querySelector(".view-slot.active .reader-view")'), true, 'Genuine unsaved edits must still block leaving the reader')
  await evaluate('[...document.querySelectorAll(".info-panel button")].find(b => b.textContent.includes("保存文献信息")).click()')
  await waitFor(() => evaluate(`window.api.library.getState().then(s => s.documents.find(d => d.id === ${JSON.stringify(original.id)}).title === 'Preserved draft title')`))
  await waitFor(() => evaluate('document.querySelector(".info-panel input").value === "Preserved draft title" && ![...document.querySelectorAll(".info-panel button")].find(b => b.textContent.includes("保存文献信息")).disabled'))
  await evaluate('document.querySelector("button[title=\\"返回文献库\\"]").click()')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .library-view")'))
  const temperature = await evaluate('window.api.library.getState().then(s => s.settings.temperature)')
  await evaluate('window.api.settings.save({temperature:0.23})')
  await evaluate(`document.querySelector('.library-folder-panel [data-folder-id="${folders[1]}"]').click()`)
  assert.equal(await evaluate(`document.querySelector('.library-folder-panel [data-folder-id="${folders[1]}"]').getAttribute('aria-selected')`), 'true',
    'Saved settings updates must not make a hidden settings editor block navigation')
  await evaluate(`(async () => {
    await window.api.settings.save({temperature:${JSON.stringify(temperature)}});
    await window.api.library.update(${JSON.stringify(original.id)}, {title:${JSON.stringify(original.title)},authors:${JSON.stringify(original.authors)},tags:${JSON.stringify(original.tags)},collections:${JSON.stringify(original.collections)}});
    for (const id of ${JSON.stringify(folders)}) await window.api.collections.remove(id);
  })()`)
  await evaluate('[...document.querySelectorAll(".library-folder-panel button")].find(b => b.textContent === "全部文献").click()')
  await waitFor(() => evaluate('!!document.querySelector(".doc-row")'))
  await evaluate('document.querySelector(".doc-row").click()')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .reader-view")'))
  await evaluate('[...document.querySelectorAll(".reader-panel .panel-tab")].find(b => b.textContent.includes("AI 助手")).click()')
  console.log('PASS: saved metadata/settings updates do not block folder navigation; actual drafts survive refreshes and remain protected until saved')
}
