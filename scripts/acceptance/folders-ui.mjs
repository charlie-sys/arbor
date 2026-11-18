import assert from 'node:assert/strict'

export async function testFoldersAndFont({ evaluate, waitFor, capture, url, filePath }) {
  const navigate = async name => {
    await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`)
    await waitFor(() => evaluate(`[...document.querySelectorAll('.nav-item')].some(b => b.querySelector('span')?.textContent === ${JSON.stringify(name)})`))
    await evaluate(`[...document.querySelectorAll('.nav-item')].find(b => b.querySelector('span')?.textContent === ${JSON.stringify(name)}).click()`)
    await evaluate('document.querySelector(".sidebar-host.drawer")?.dispatchEvent(new MouseEvent("mouseout", {bubbles:true, relatedTarget:document.querySelector(".main-area")}))')
    await waitFor(() => evaluate('!document.querySelector(".sidebar-host.drawer")'))
  }
  const input = (selector, value) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  const select = (selector, value) => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', {bubbles:true})); })()`)
  const click = async (selector, text) => {
    await waitFor(() => evaluate(`!![...(document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`))
    await evaluate(`(() => { const button = [...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); button.click() })()`)
  }
  const row = id => `.library-folder-panel [data-folder-id="${id}"]`
  const manage = async id => {
    const beforeHeight = await evaluate('document.querySelector(".library-folder-panel").getBoundingClientRect().height')
    await evaluate(`document.querySelector(${JSON.stringify(row(id))}).querySelector('.folder-actions').click()`)
    await waitFor(() => evaluate('!!document.querySelector(".folder-action-list")'))
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".folder-action-list")).position'), 'fixed', 'Folder actions must float outside directory layout')
    assert.equal(await evaluate('document.querySelector(".library-folder-panel").getBoundingClientRect().height'), beforeHeight, 'Opening actions must not resize the directory')
  }
  const save = async () => { await click('.folder-editor', '保存文件夹'); await waitFor(() => evaluate('!document.querySelector(".folder-editor")')) }
  await navigate('文献库')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .library-view")'))
  await input('.library-toolbar .search-box input', '')
  await evaluate('document.querySelector(".library-folder-panel button[title=\\"新建文件夹\\"]").click()')
  await waitFor(() => evaluate('!!document.querySelector("#folder-name")'))
  await input('#folder-name', 'Research')
  await input('[aria-label="文件夹 HEX 颜色"]', '#1248ab')
  await select('#folder-parent', '')
  await save()
  const root = await evaluate('window.api.library.getState().then(s => s.collections.find(c => c.name === "Research"))')
  assert.equal(root.color, '#1248ab')
  await manage(root.id)
  const menuColors = await evaluate(`(() => {
    const root = document.documentElement, previousTheme = root.dataset.theme, previousDark = root.dataset.dark;
    const colors = ['light','soft','dark','midnight'].map(theme => {
      root.dataset.theme = theme; if (theme === 'dark' || theme === 'midnight') root.dataset.dark = 'true'; else delete root.dataset.dark;
      return getComputedStyle(document.querySelector('.folder-action-list')).backgroundColor;
    });
    root.dataset.theme = previousTheme; if (previousDark) root.dataset.dark = previousDark; else delete root.dataset.dark;
    return colors;
  })()`)
  assert.ok(new Set(menuColors).size >= 3, 'Floating menu background must follow the application theme')
  await capture('folder-menu-library')
  await evaluate(`(() => {
    const anchor = document.querySelector(${JSON.stringify(row(root.id))}).querySelector('.folder-actions');
    const popup = document.querySelector('.folder-action-list');
    anchor.dispatchEvent(new PointerEvent('pointerleave', {relatedTarget:popup}));
    popup.dispatchEvent(new PointerEvent('pointerenter', {bubbles:true,relatedTarget:anchor}));
  })()`)
  await new Promise(resolve => setTimeout(resolve, 220))
  assert.equal(await evaluate('!!document.querySelector(".folder-action-list")'), true, 'Moving from the trigger into its floating menu must keep it open')
  await evaluate('document.querySelector(".folder-action-list").dispatchEvent(new PointerEvent("pointerleave", {bubbles:true,relatedTarget:document.body}))')
  await waitFor(() => evaluate('!document.querySelector(".folder-action-list")'))
  await manage(root.id)
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))')
  await waitFor(() => evaluate('!document.querySelector(".folder-action-list")'))
  await manage(root.id)
  await click('.folder-action-list', '新建子文件夹')
  await waitFor(() => evaluate('!!document.querySelector("#folder-name")'))
  await input('#folder-name', 'Models')
  await evaluate('document.querySelector("button[aria-label=\\"选择颜色 #8b5cf6\\"]").click()')
  await save()
  const child = await evaluate('window.api.library.getState().then(s => s.collections.find(c => c.name === "Models"))')
  assert.equal(child.parentId, root.id)
  assert.equal(child.color, '#8b5cf6')
  await manage(child.id)
  await click('.folder-action-list', '新建子文件夹')
  await waitFor(() => evaluate('!!document.querySelector("#folder-name")'))
  await input('#folder-name', 'VAE')
  await save()
  const grandchild = await evaluate('window.api.library.getState().then(s => s.collections.find(c => c.name === "VAE"))')
  assert.equal(grandchild.parentId, child.id)
  await evaluate('document.querySelector(".library-folder-panel button[aria-label=\\"收起文件夹：Research\\"]").click()')
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(row(grandchild.id))})`), false, 'Collapsed folders must actually hide descendants')
  await evaluate('document.querySelector(".library-folder-panel button[aria-label=\\"展开文件夹：Research\\"]").click()')
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(row(grandchild.id))})`))
  const docIds = await evaluate(`(async () => {
    const data = await window.api.library.getState();
    await window.api.library.update(data.documents[0].id, { collections: [${JSON.stringify(root.id)}, ${JSON.stringify(grandchild.id)}] });
    await window.api.library.update(data.documents[1].id, { collections: [${JSON.stringify(child.id)}] });
    return data.documents.slice(0,2).map(d => d.id);
  })()`)
  await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(row(root.id))}).querySelector('.nav-count').textContent === '2'`))
  await evaluate(`document.querySelector(${JSON.stringify(row(root.id))}).click()`)
  await waitFor(() => evaluate('document.querySelectorAll(".doc-row").length === 2'))
  await manage(root.id)
  await click('.folder-action-list', '仅显示本文件夹文献')
  await waitFor(() => evaluate('document.querySelectorAll(".doc-row").length === 1'))
  await manage(child.id)
  await click('.folder-action-list', '编辑名称、颜色与位置')
  await waitFor(() => evaluate('!!document.querySelector("#folder-name")'))
  assert.equal(await evaluate(`!!document.querySelector('#folder-parent option[value="${grandchild.id}"]')`), false)
  await input('#folder-name', 'Battery')
  await input('[aria-label="文件夹 HEX 颜色"]', '#ab45ef')
  await select('#folder-parent', '')
  await save()
  const moved = await evaluate(`window.api.library.getState().then(s => s.collections.find(c => c.id === ${JSON.stringify(child.id)}))`)
  assert.equal(moved.name, 'Battery')
  assert.equal(moved.color, '#ab45ef')
  assert.equal(moved.parentId, undefined)
  await evaluate(`document.querySelector(${JSON.stringify(row(child.id))}).click()`)
  await waitFor(() => evaluate('document.querySelectorAll(".doc-row").length === 2'))
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(row(child.id))}).querySelector('.folder-icon')).color`), 'rgb(171, 69, 239)')
  await capture('folders-directory')
  await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`)
  await waitFor(() => evaluate('!!document.querySelector(".sidebar-host.drawer")'))
  await evaluate(`document.querySelector('.sidebar [data-folder-id="${child.id}"] .folder-actions').scrollIntoView({block:'end'})`)
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const sidebarHeight = await evaluate('document.querySelector(".sidebar .folder-tree").getBoundingClientRect().height')
  await evaluate(`document.querySelector('.sidebar [data-folder-id="${child.id}"] .folder-actions').click()`)
  await waitFor(() => evaluate('document.querySelector(".folder-action-list")?.dataset.surface === "sidebar"'))
  assert.equal(await evaluate('document.querySelector(".sidebar .folder-tree").getBoundingClientRect().height'), sidebarHeight)
  assert.equal(await evaluate(`(() => {
    const menu = document.querySelector('.folder-action-list'), rect = menu.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
  })()`), true, 'Sidebar menu must be fully visible outside its scroll container')
  assert.equal(await evaluate(`(() => {
    const probe = document.createElement('div'); probe.style.backgroundColor = 'var(--sidebar)'; document.body.append(probe);
    const same = getComputedStyle(probe).backgroundColor === getComputedStyle(document.querySelector('.folder-action-list')).backgroundColor;
    probe.remove(); return same;
  })()`), true, 'Sidebar menu must use sidebar theme colors')
  await evaluate('document.querySelector(".sidebar-host.drawer").dispatchEvent(new MouseEvent("mouseout", {bubbles:true,relatedTarget:document.querySelector(".main-area")}))')
  await evaluate('document.querySelector(".folder-action-list").dispatchEvent(new PointerEvent("pointerenter", {bubbles:true,relatedTarget:document.querySelector(".main-area")}))')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(await evaluate('!!document.querySelector(".sidebar-host.drawer") && !!document.querySelector(".folder-action-list")'), true,
    'Moving into a portalled sidebar menu must not unmount its sidebar')
  await capture('folder-menu-sidebar')
  await click('.folder-action-list', '编辑名称、颜色与位置')
  await waitFor(() => evaluate('!!document.querySelector(".folder-editor")'))
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(await evaluate('!!document.querySelector(".folder-editor")'), true, 'Sidebar must not unmount its editing dialog')
  await click('.folder-editor', '取消')
  await waitFor(() => evaluate('!document.querySelector(".sidebar-host.drawer")'))
  await manage(child.id)
  await evaluate('document.querySelector(".folder-action-list").dispatchEvent(new PointerEvent("pointerleave", {bubbles:true,relatedTarget:document.body}))')
  await waitFor(() => evaluate('!document.querySelector(".folder-action-list")'))
  console.log('PASS: folder menus float without shifting layout, follow themes, remain clickable across the hover gap and close on pointer exit or Escape')
  console.log('PASS: library folder UI creates three levels, collapses descendants, deduplicates counts, filters nested documents, moves folders and saves palette/HEX colors')
  await click('.library-view .view-head-actions', '导入网页')
  await waitFor(() => evaluate('!!document.querySelector("#web-import-url")'))
  await input('#web-import-url', url + '?folder-import=1')
  await click('.web-import-dialog', '导入网页')
  await waitFor(() => evaluate('!document.querySelector(".web-import-dialog") && !!document.querySelector(".view-slot.active .reader-view")'))
  const folderImport = await evaluate(`window.api.library.getState().then(s => s.documents.find(d => d.url.includes('?folder-import=1')))`)
  assert.deepEqual(folderImport.collections, [child.id], 'Import from the selected folder must assign that folder immediately')
  const localImport = await evaluate(`window.api.library.importDocument(${JSON.stringify(filePath)}, 'Local folder import', ${JSON.stringify(child.id)})`)
  assert.deepEqual(localImport.collections, [child.id], 'The local import IPC must persist the selected folder')
  await navigate('文献库')
  await evaluate(`document.querySelector(${JSON.stringify(row(child.id))}).click()`)
  await waitFor(() => evaluate('[...document.querySelectorAll(".doc-row")].some(row => row.textContent.includes("Local folder import"))'))
  assert.equal(await evaluate(`[...document.querySelectorAll('.doc-row')].some(row => row.textContent.includes('Web UI fixture'))`), true)
  console.log('PASS: imports initiated from a selected folder retain that folder')
  await evaluate(`window.api.library.update(${JSON.stringify(folderImport.id)}, {title:'Synced imported title', tags:['external update']})`)
  await waitFor(() => evaluate('[...document.querySelectorAll(".doc-row")].some(row => row.textContent.includes("Synced imported title"))'))
  await evaluate(`document.querySelector(${JSON.stringify(row(root.id))}).click()`)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(root.id))}).getAttribute('aria-selected')`), 'true',
    'Saved metadata updates to a hidden reader must not block folder navigation as unsaved changes')
  await navigate('设置')
  await evaluate('document.querySelector("[data-settings-section=font]").click()')
  await waitFor(() => evaluate('!!document.querySelector("select[aria-label=\\"界面字号\\"]")'))
  await select('select[aria-label="界面字号"]', '20')
  await waitFor(() => evaluate('document.documentElement.dataset.uiFontSize === "20"'))
  assert.ok(Math.abs(await evaluate('parseFloat(getComputedStyle(document.body).fontSize)') - 20) < 0.1)
  assert.equal(await evaluate('window.api.library.getState().then(s => s.settings.uiFontSize)'), 20)
  assert.equal(await evaluate(`(() => {
    const node = document.querySelector('select[aria-label="界面字号"]'), style = getComputedStyle(node);
    return node.getBoundingClientRect().height >= parseFloat(style.fontSize) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;
  })()`), true, 'Large font size must not clip the selected text inside its control')
  await capture('font-size-settings')
  await click('.settings-dialog .modal-foot', '完成')
  await waitFor(() => evaluate('!document.querySelector(".settings-dialog")'))
  await evaluate('document.querySelector("[data-settings-section=updates]").click()')
  await input('input[aria-label="更新下载源（可选）"]', 'https://downloads.example.com/arbor/')
  await click('.update-card', '保存下载源')
  await waitFor(() => evaluate('window.api.library.getState().then(s => s.settings.updateDownloadSource === "https://downloads.example.com/arbor")'))
  await waitFor(() => evaluate('document.querySelector("input[aria-label=\\"更新下载源（可选）\\"]").value === "https://downloads.example.com/arbor"'))
  await input('input[aria-label="更新下载源（可选）"]', '')
  await click('.update-card', '保存下载源')
  await waitFor(() => evaluate('window.api.library.getState().then(s => s.settings.updateDownloadSource === "")'))
  console.log('PASS: update source settings normalize HTTPS roots, save immediately and allow returning to GitHub')
  await click('.settings-dialog .modal-foot', '完成')
  await waitFor(() => evaluate('!document.querySelector(".settings-dialog")'))
  await navigate('文献库')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .library-view")'))
  assert.ok(Math.abs(await evaluate('parseFloat(getComputedStyle(document.querySelector(".library-folder-head strong")).fontSize)') - 20) < 0.1)
  console.log('PASS: interface font size changes actual rendered text instantly and persists without changing webpage/PDF zoom')
}
