import assert from 'node:assert/strict'

export async function testLibraryPagination({ evaluate, waitFor, capture, sourcePath }) {
  const selectSize = size => evaluate(`(() => { const input=document.querySelector('.library-pagination select'); input.value='${size}'; input.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  const input = (selector, text) => evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(text)}); node.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  const click = text => evaluate(`(()=>{const node=[...document.querySelectorAll('.library-view .batch-toolbar button')].find(n=>n.textContent.trim()===${JSON.stringify(text)});node.click()})()`)
  const button = label => evaluate(`document.querySelector('.library-pagination button[aria-label="${label}"]').click()`)
  const jump = async page => { await input('#library-jump-page', String(page)); await evaluate('document.querySelector(".pagination-jump").requestSubmit()') }
  const count = () => evaluate('document.querySelectorAll(".library-view .doc-row").length')
  const page = () => evaluate('document.querySelector("#library-jump-page").value')
  await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`)
  await waitFor(() => evaluate(`[...document.querySelectorAll('.nav-item')].some(n=>n.querySelector('span')?.textContent==='文献库')`))
  await evaluate(`[...document.querySelectorAll('.nav-item')].find(n=>n.querySelector('span')?.textContent==='文献库').click()`)
  await evaluate('document.querySelector(".sidebar-host.drawer")?.dispatchEvent(new MouseEvent("mouseout",{bubbles:true,relatedTarget:document.querySelector(".main-area")}))')
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .library-view") && !document.querySelector(".sidebar-host.drawer")'))
  // Existing user-shrunk widths must not leave the new full-width list narrow.
  const savedSize = await evaluate('localStorage.getItem("arbor-library-page-size")')
  const fixture = await evaluate(`(async()=>{
    const folder=await window.api.collections.add('Pagination folder'); const ids=[];
    for(let i=0;i<53;i++) {
      const doc=await window.api.library.importDocument(${JSON.stringify(sourcePath)},'Pagination fixture '+String(i).padStart(2,'0'));
      if(i<4) await window.api.library.update(doc.id,{collections:[folder.id]});
      ids.push(doc.id);
    } return {ids,folder:folder.id};
  })()`)
  await evaluate(`[...document.querySelectorAll('.library-folder-panel button')].find(n=>n.textContent==='全部文献').click()`)
  await input('.library-toolbar .search-box input', 'Pagination fixture')
  await selectSize(20)
  await waitFor(async () => await count() === 20 && await page() === '1')
  assert(await evaluate('document.querySelector("[data-testid=library-page-count]").textContent.includes("3")'))
  assert.equal(await evaluate(`(() => {
    const section=document.querySelector('.library-documents').getBoundingClientRect();
    const wrap=document.querySelector('.library-view .doc-table-wrap').getBoundingClientRect();
    const pager=document.querySelector('.library-pagination').getBoundingClientRect();
    return Math.abs(section.width-wrap.width)<2 && Math.abs(section.bottom-pager.bottom)<2 && wrap.height>150 && pager.bottom<=innerHeight;
  })()`), true, 'Table fills the available area while pagination remains in view')
  await button('最后一页')
  await waitFor(async () => await count() === 13 && await page() === '3')
  await selectSize(10)
  await waitFor(async () => await count() === 10 && await page() === '1')
  assert.equal(await evaluate('localStorage.getItem("arbor-library-page-size")'), '10')
  await jump(2)
  await waitFor(async () => await page() === '2')
  await evaluate('document.querySelector(".doc-table th.sortable").click()')
  await waitFor(async () => await page() === '1')
  assert.equal(await evaluate('document.querySelector(".doc-row .cell-title-text").textContent'), 'Pagination fixture 00')
  await capture('library-pagination')
  await evaluate('document.querySelector(".doc-row input[type=checkbox]").click()')
  await button('下一页')
  await waitFor(async () => await page() === '2')
  await evaluate('document.querySelector(".doc-table thead input[type=checkbox]").click()')
  assert(await evaluate('document.querySelector(".library-view .batch-count").textContent.includes("11 / 53")'))
  await button('第一页')
  await waitFor(async () => await page() === '1')
  assert.equal(await evaluate('document.querySelector(".doc-table thead input").indeterminate'), true)
  await click('全不选')
  await click('全选筛选结果')
  assert(await evaluate('document.querySelector(".library-view .batch-count").textContent.includes("53 / 53")'))
  await click('全不选')
  await jump(999)
  await waitFor(async () => await page() === '6' && await count() === 3)
  await click('全选当前页')
  await click('批量删除')
  await waitFor(() => evaluate('!!document.querySelector("#batch-delete-code")'))
  const code=await evaluate('document.querySelector("[data-testid=batch-delete-challenge]").textContent')
  await input('#batch-delete-code',code)
  await evaluate('document.querySelector(".batch-delete-dialog").requestSubmit()')
  await waitFor(async () => !(await evaluate('!!document.querySelector(".batch-delete-dialog")')) && await page() === '5' && await count() === 10)
  await input('.library-toolbar .search-box input','Pagination fixture 4')
  await waitFor(async () => await page() === '1' && await count() === 10)
  await input('.library-toolbar .search-box input','Pagination fixture')
  await jump(3)
  await waitFor(async () => await page() === '3')
  await evaluate(`document.querySelector('.library-folder-panel [data-folder-id="${fixture.folder}"]').click()`)
  await waitFor(async () => await page() === '1' && await count() === 4)
  await input('.library-toolbar .search-box input','No matching pagination fixture')
  await waitFor(async () => await count() === 0 && await page() === '0')
  assert.equal(await evaluate('document.querySelector(".library-pagination button[aria-label=下一页]").disabled'), true)
  await evaluate(`(async()=>{await window.api.library.batchRemove(${JSON.stringify(fixture.ids)});await window.api.collections.remove(${JSON.stringify(fixture.folder)});})()`)
  await evaluate(`[...document.querySelectorAll('.library-folder-panel button')].find(n=>n.textContent==='全部文献').click()`)
  await input('.library-toolbar .search-box input','')
  await selectSize(savedSize ? Number(savedSize) : 20)
  console.log('PASS: full-area document table paginates globally sorted/filtered results, persists page size, clamps jumps and resets on folder changes')
  console.log('PASS: selection distinguishes current page from all filtered results; deleting the last page clamps to a populated page; empty results show zero pages')
}
