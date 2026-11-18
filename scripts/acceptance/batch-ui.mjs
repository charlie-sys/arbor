import assert from 'node:assert/strict'

// Invoked inside research-ui.mjs's isolated, running Electron application.
export async function testBatchUi({ evaluate, waitFor, url, capture }) {
  const click = (selector, text) => evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    const button = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Missing or disabled button: ' + ${JSON.stringify(text)});
    button.click();
  })()`)
  const input = (selector, value) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const select = (selector, value) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await evaluate('document.querySelector("button[title=\\"返回文献库\\"]")?.click()')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .library-view")'))
  const fixture = await evaluate(`(async () => {
    const first = await window.api.collections.add('Bulk original');
    const second = await window.api.collections.add('Bulk added');
    const docs = [];
    for (let i = 1; i <= 3; i++) {
      const doc = await window.api.library.importUrl(${JSON.stringify(url)} + '?bulk=' + i);
      await window.api.library.update(doc.id, { title: 'Bulk fixture ' + i, collections: [first.id], tags: ['original'] });
      docs.push(doc.id);
    }
    return { docs, first: first.id, second: second.id };
  })()`)
  await input('.library-toolbar .search-box input', 'Bulk fixture')
  await waitFor(() => evaluate('document.querySelectorAll(".doc-row").length === 3'))
  await click('.library-view .batch-toolbar', '全选')
  assert.equal(await evaluate('document.querySelectorAll(".doc-row input[type=checkbox]:checked").length'), 3)
  await click('.library-view .batch-toolbar', '全不选')
  assert.equal(await evaluate('document.querySelectorAll(".doc-row input[type=checkbox]:checked").length'), 0)
  await evaluate(`(() => { for (const title of ['Bulk fixture 1', 'Bulk fixture 2']) document.querySelector('input[aria-label="选择文献：' + title + '"]').click() })()`)
  assert.equal(await evaluate('!!document.querySelector(".view-slot.active .library-view")'), true, 'Checkbox selection must not open the reader')
  await click('.library-view .batch-toolbar', '批量修改')
  await select('[aria-label="批量阅读状态"]', 'read')
  await select('[aria-label="批量分类操作"]', 'add')
  await evaluate(`(() => { const label = [...document.querySelectorAll('.batch-collection-list label')].find(l => l.textContent === 'Bulk added'); label.querySelector('input').click() })()`)
  await select('[aria-label="批量标签操作"]', 'add')
  await input('[aria-label="批量标签"]', 'new, second')
  await capture('batch-edit')
  await click('.batch-edit-dialog', '应用修改')
  await waitFor(() => evaluate('!document.querySelector(".batch-edit-dialog")'))
  const updated = await evaluate(`window.api.library.getState().then(s => ${JSON.stringify(fixture.docs)}.map(id => s.documents.find(d => d.id === id)))`)
  assert.equal(updated[0].readingStatus, 'read')
  assert.deepEqual(updated[0].collections, [fixture.first, fixture.second])
  assert.deepEqual(updated[1].tags, ['original', 'new', 'second'])
  assert.equal(updated[2].readingStatus, 'unread')
  assert.deepEqual(updated[2].collections, [fixture.first])
  console.log('PASS: document checkboxes, select/deselect all, bulk status and additive categories/tags preserve unselected documents')
  await input('.library-toolbar .search-box input', 'Bulk fixture 1')
  await waitFor(() => evaluate('document.querySelectorAll(".doc-row").length === 1'))
  await click('.library-view .batch-toolbar', '全选')
  await click('.library-view .batch-toolbar', '批量删除')
  await waitFor(() => evaluate('!!document.querySelector(".batch-delete-dialog")'))
  const firstCode = await evaluate('document.querySelector("[data-testid=batch-delete-challenge]").textContent')
  assert.match(firstCode, /^\d{6}$/)
  await capture('batch-delete')
  assert.equal(await evaluate('document.querySelector(".batch-delete-dialog button[type=submit]").disabled'), true)
  await input('#batch-delete-code', '000000')
  await evaluate('document.querySelector(".batch-delete-dialog").requestSubmit()')
  assert.equal(await evaluate(`window.api.library.getState().then(s => s.documents.some(d => d.id === ${JSON.stringify(fixture.docs[0])}))`), true)
  await click('.batch-delete-dialog', '取消')
  await waitFor(() => evaluate('!document.querySelector(".batch-delete-dialog")'))
  await click('.library-view .batch-toolbar', '批量删除')
  const code = await evaluate('document.querySelector("[data-testid=batch-delete-challenge]").textContent')
  await input('#batch-delete-code', code)
  await click('.batch-delete-dialog', '确认删除')
  await waitFor(() => evaluate('!document.querySelector(".batch-delete-dialog") && document.querySelectorAll(".doc-row").length === 0'))
  assert.equal(await evaluate(`window.api.library.getState().then(s => s.documents.filter(d => ${JSON.stringify(fixture.docs)}.includes(d.id)).length)`), 2,
    'Select all on filtered results must not include hidden documents')
  console.log('PASS: document bulk deletion requires the displayed random code; incorrect input, Enter and cancel preserve data; filtered select-all excludes hidden records')
  const chats = await evaluate(`(async () => {
    const ids = [];
    for (let i = 1; i <= 3; i++) { const chat = await window.api.chats.create([]); await window.api.chats.update(chat.id, {title: 'Bulk conversation ' + i}); ids.push(chat.id); }
    return ids;
  })()`)
  await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`)
  await waitFor(() => evaluate('[...document.querySelectorAll(".nav-item")].some(b => b.querySelector("span")?.textContent === "AI 对话")'))
  await evaluate('[...document.querySelectorAll(".nav-item")].find(b => b.querySelector("span")?.textContent === "AI 对话").click()')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .chat-page")'))
  await click('.chat-page .batch-toolbar', '全选')
  assert.equal(await evaluate('document.querySelectorAll(".session-batch-check:checked").length === document.querySelectorAll(".session-item").length'), true)
  await click('.chat-page .batch-toolbar', '全不选')
  assert.equal(await evaluate('document.querySelectorAll(".session-batch-check:checked").length'), 0)
  await evaluate(`(() => { for (const title of ['Bulk conversation 1', 'Bulk conversation 2']) document.querySelector('input[aria-label="选择会话：' + title + '"]').click(); })()`)
  await click('.chat-page .batch-toolbar', '批量删除')
  await waitFor(() => evaluate('!!document.querySelector(".batch-delete-dialog")'))
  await input('#batch-delete-code', '000000')
  assert.equal(await evaluate('document.querySelector(".batch-delete-dialog button[type=submit]").disabled'), true)
  await click('.batch-delete-dialog', '取消')
  await click('.chat-page .batch-toolbar', '批量删除')
  const chatCode = await evaluate('document.querySelector("[data-testid=batch-delete-challenge]").textContent')
  await input('#batch-delete-code', chatCode)
  await click('.batch-delete-dialog', '确认删除')
  await waitFor(() => evaluate('!document.querySelector(".batch-delete-dialog") && !document.querySelector("input[aria-label=\\"选择会话：Bulk conversation 1\\"]")'))
  const remaining = await evaluate(`window.api.library.getState().then(s => s.chats.filter(c => ${JSON.stringify(chats)}.includes(c.id)).map(c => c.id))`)
  assert.deepEqual(remaining, [chats[2]])
  console.log('PASS: conversation select/deselect all and random-code-confirmed bulk deletion preserve unselected conversations')
  const aliSessions = await evaluate(`(async () => {
    const ids = [];
    for (let i = 1; i <= 3; i++) { const session = await window.api.ali.createSession(); await window.api.ali.updateSession(session.id, { title: 'Bulk Ali ' + i }); ids.push(session.id); }
    return ids;
  })()`)
  await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`)
  await waitFor(() => evaluate('[...document.querySelectorAll(".nav-item")].some(b => b.querySelector("span")?.textContent === "阿栗")'))
  await evaluate('[...document.querySelectorAll(".nav-item")].find(b => b.querySelector("span")?.textContent === "阿栗").click()')
  await waitFor(() => evaluate('document.querySelectorAll(".ali-view .session-item").length === 3'))
  await click('.ali-view .batch-toolbar', '全选')
  assert.equal(await evaluate('document.querySelectorAll(".ali-view .session-batch-check:checked").length'), 3)
  await click('.ali-view .batch-toolbar', '全不选')
  assert.equal(await evaluate('document.querySelectorAll(".ali-view .session-batch-check:checked").length'), 0)
  await evaluate('[...document.querySelectorAll(".ali-view .session-item")].find(n => n.querySelector(".session-title").textContent === "Bulk Ali 1").click()')
  await evaluate(`(() => { for (const title of ['Bulk Ali 1', 'Bulk Ali 2']) document.querySelector('input[aria-label="选择阿栗会话：' + title + '"]').click(); })()`)
  assert.equal(await evaluate('document.querySelector(".ali-view .chat-head h2").textContent'), 'Bulk Ali 1', 'Selecting checkboxes must not change the active Ali conversation')
  await click('.ali-view .batch-toolbar', '批量删除')
  await input('#batch-delete-code', '000000')
  assert.equal(await evaluate('document.querySelector(".batch-delete-dialog button[type=submit]").disabled'), true)
  await evaluate('document.querySelector(".batch-delete-dialog").requestSubmit()')
  assert.equal(await evaluate('window.api.ali.getState().then(s => s.sessions.length)'), 3)
  await click('.batch-delete-dialog', '取消')
  await click('.ali-view .batch-toolbar', '批量删除')
  const aliCode = await evaluate('document.querySelector("[data-testid=batch-delete-challenge]").textContent')
  await input('#batch-delete-code', aliCode)
  await click('.batch-delete-dialog', '确认删除')
  await waitFor(() => evaluate('!document.querySelector(".batch-delete-dialog") && document.querySelectorAll(".ali-view .session-item").length === 1'))
  assert.deepEqual(await evaluate('window.api.ali.getState().then(s => s.sessions.map(c => c.id))'), [aliSessions[2]])
  assert.equal(await evaluate('document.querySelector(".ali-view .chat-head h2").textContent'), 'Bulk Ali 3')
  console.log('PASS: Ali select/deselect all and random-code-confirmed deletion preserve unselected sessions and switch away from a deleted active session')
}
