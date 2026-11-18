import assert from 'node:assert/strict'

export async function testSettingsListAndLocale({ evaluate, waitFor, capture, inspectWindows }) {
  const input = (selector, text) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${JSON.stringify(text)});
    node.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  const open = id => evaluate(`document.querySelector('[data-settings-section=${id}]').click()`)
  const close = async () => {
    await waitFor(() => evaluate(`!!document.querySelector('.settings-dialog .modal-foot .btn.ghost:not(:disabled)')`))
    await evaluate(`document.querySelector('.settings-dialog .modal-foot .btn.ghost').click()`)
    await waitFor(() => evaluate('!document.querySelector(".settings-dialog")'))
  }
  const original = await evaluate(`window.api.library.getState().then(s => ({model:s.settings.chatModel, docs:s.documents.map(d=>({id:d.id,title:d.title,notes:d.notes,authors:d.authors})), chats:s.chats}))`)
  const textBefore = await evaluate(`window.api.library.getState().then(s => Promise.all(s.documents.map(d=>window.api.library.getTexts(d.id))))`)
  await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`)
  await waitFor(() => evaluate(`[...document.querySelectorAll('.nav-item')].some(b=>b.querySelector('span')?.textContent === '设置')`))
  await evaluate(`[...document.querySelectorAll('.nav-item')].find(b=>b.querySelector('span')?.textContent === '设置').click()`)
  await evaluate('document.querySelector(".sidebar-host.drawer")?.dispatchEvent(new MouseEvent("mouseout",{bubbles:true,relatedTarget:document.querySelector(".main-area")}))')
  await waitFor(() => evaluate('!document.querySelector(".sidebar-host.drawer")'))
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .settings-list")'))
  assert.equal(await evaluate('document.querySelectorAll(".settings-list-item").length'), 8)
  assert.equal(await evaluate('document.querySelectorAll(".settings-view input, .settings-view select, .settings-view textarea").length'), 0)
  const boxes = () => evaluate(`[...document.querySelectorAll('.settings-list-item')].map(n => {const r=n.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]})`)
  const before = await boxes()
  await open('models')
  await waitFor(() => evaluate('!!document.querySelector(".settings-dialog")'))
  assert.deepEqual(await boxes(), before, 'Opening details must not shift the list')
  assert.equal(await evaluate('document.querySelector(".settings-dialog-backdrop").parentElement === document.body'), true)
  const modelInput = '.settings-dialog .field-row .field input'
  await input(modelInput, 'preserved-settings-draft')
  await close()
  await waitFor(() => evaluate('!document.querySelector(".settings-dialog")'))
  await open('models')
  assert.equal(await evaluate(`document.querySelector('${modelInput}').value`), 'preserved-settings-draft')
  await evaluate('document.querySelector(".settings-dialog .modal-foot .btn.primary").click()')
  await waitFor(() => evaluate('window.api.library.getState().then(s => s.settings.chatModel === "preserved-settings-draft")'))
  await close()
  await evaluate(`window.api.settings.save({chatModel:${JSON.stringify(original.model)}})`)
  await open('language')
  await evaluate(`document.querySelectorAll('.settings-dialog .preset')[2].click()`)
  await waitFor(() => evaluate('document.documentElement.lang === "en" && document.querySelector(".settings-dialog h2").textContent === "Interface language"'))
  assert.equal(await evaluate('/[\u4e00-\u9fff]/.test(document.querySelector(".settings-list").textContent)'), false)
  await waitFor(async () => (await inspectWindows()).every(w => w.lang === 'en'))
  await close()
  await open('models')
  assert(await evaluate('document.querySelector(".settings-dialog").textContent.includes("API endpoint")'))
  await capture('settings-models-english')
  // Keyboard navigation stays inside the dialog; Escape closes and returns focus to its row.
  assert.equal(await evaluate(`(() => {
    const buttons = [...document.querySelector('.settings-dialog').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(n=>n.getClientRects().length);
    buttons.at(-1).focus(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
    return document.activeElement === buttons[0];
  })()`), true)
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))')
  await waitFor(() => evaluate('!document.querySelector(".settings-dialog")'))
  assert.equal(await evaluate('document.activeElement.dataset.settingsSection'), 'models')
  await capture('settings-list-english')
  await open('language')
  await evaluate(`document.querySelectorAll('.settings-dialog .preset')[1].click()`)
  await waitFor(() => evaluate('document.documentElement.lang === "zh-HK" && document.querySelector(".settings-list").textContent.includes("介面")'))
  await waitFor(async () => (await inspectWindows()).every(w => w.lang === 'zh-HK'))
  await close()
  await open('models')
  assert(await evaluate('document.querySelector(".settings-dialog").textContent.includes("API 金鑰")'))
  await close()
  await open('language')
  await evaluate(`document.querySelectorAll('.settings-dialog .preset')[0].click()`)
  await waitFor(() => evaluate('document.documentElement.lang === "zh-CN"'))
  await close()
  const after = await evaluate(`window.api.library.getState().then(s => ({model:s.settings.chatModel, docs:s.documents.map(d=>({id:d.id,title:d.title,notes:d.notes,authors:d.authors})), chats:s.chats}))`)
  assert.deepEqual(after, original, 'Language changes must preserve authored data')
  assert.deepEqual(await evaluate(`window.api.library.getState().then(s => Promise.all(s.documents.map(d=>window.api.library.getTexts(d.id))))`), textBefore)
  console.log('PASS: settings use floating themed dialogs without moving rows; drafts persist, keyboard focus is trapped and Escape restores focus')
  console.log('PASS: English and Traditional Chinese update all open windows without rewriting document text, notes, titles or chat history')
}
