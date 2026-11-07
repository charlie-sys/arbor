const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (fn, label, timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = fn()
    if (value) return value
    await sleep(100)
  }
  throw new Error(`等待超时：${label}`)
}

const activeSlot = () => document.querySelector('.view-slot.active')
const nodeList = () => [...(activeSlot()?.querySelectorAll('[data-canvas-node]') ?? [])]
const edgeList = () => [...(activeSlot()?.querySelectorAll('[data-canvas-edge]') ?? [])]
const zoomText = () => activeSlot()?.querySelector('[data-canvas-zoom]')?.textContent?.trim() ?? ''
const worldTransform = () => activeSlot()?.querySelector('[data-canvas-world]')?.style.transform ?? ''
const boardName = () => activeSlot()?.querySelector('.view-head select')?.selectedOptions?.[0]?.textContent?.trim() ?? ''

const pointerDown = (element) => {
  element.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
  )
}

const pointer = (type, x, y) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, clientX: x, clientY: y })

const dragBy = async (element, dx, dy) => {
  const rect = element.getBoundingClientRect()
  const x = rect.left + 24
  const y = rect.top + 24
  element.dispatchEvent(pointer('pointerdown', x, y))
  element.dispatchEvent(pointer('pointermove', x + dx, y + dy))
  element.dispatchEvent(pointer('pointerup', x + dx, y + dy))
  await sleep(120)
}

const resizeBy = async (card, dx, dy) => {
  const handle = card.querySelector('[data-canvas-resize]')
  const rect = handle.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  handle.dispatchEvent(pointer('pointerdown', x, y))
  handle.dispatchEvent(pointer('pointermove', x + dx, y + dy))
  handle.dispatchEvent(pointer('pointerup', x + dx, y + dy))
  await sleep(150)
}

const styleBox = (element) => ({
  left: Number.parseFloat(element.style.left),
  top: Number.parseFloat(element.style.top),
  width: Number.parseFloat(element.style.width),
  height: Number.parseFloat(element.style.height)
})

const openCanvasFromSidebar = async () => {
  if (!document.querySelector('.nav-item')) {
    const edge = await waitFor(() => document.querySelector('.sidebar-edge'), '侧栏边缘')
    edge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await waitFor(() => document.querySelector('.nav-item'), '侧栏展开')
  }
  const entry = await waitFor(
    () => [...document.querySelectorAll('.nav-item')].find((item) => item.textContent?.includes('主题画布')),
    '侧边栏主题画布入口'
  )
  entry.click()
  await waitFor(
    () => activeSlot()?.querySelector('.view-head h1')?.textContent?.trim() === '主题画布',
    '主题画布标题'
  )
  return { entry, active: entry.classList.contains('active') }
}

const phaseOne = async () => {
  const sidebar = await openCanvasFromSidebar()
  const originalCapture = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = function () {}
  const originalConfirm = window.confirm
  window.confirm = () => true

  const submitDialog = async (value) => {
    const input = await waitFor(() => document.querySelector('[data-canvas-dialog-input]'), '命名弹窗')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => !document.querySelector('[data-canvas-dialog-confirm]')?.disabled, '命名弹窗可提交')
    document.querySelector('[data-canvas-dialog-confirm]').click()
    await waitFor(() => !document.querySelector('[data-canvas-dialog]'), '命名弹窗关闭')
  }

  const naming = { created: false, renamed: false, section: false }
  const newButton = await waitFor(() => document.querySelector('[data-canvas-new]'), '新建画布按钮')
  newButton.click()
  await submitDialog('验收画布')
  const addSelect = await waitFor(() => document.querySelector('[data-canvas-add]'), '添加卡片下拉框')
  await waitFor(() => boardName() === '验收画布', '画布创建完成')
  naming.created = true

  const renameButton = () =>
    [...(activeSlot()?.querySelectorAll('.view-head button') ?? [])].find((button) => button.textContent?.trim() === '重命名')
  renameButton()?.click()
  await submitDialog('验收画布-重命名')
  await waitFor(() => boardName() === '验收画布-重命名', '画布重命名')
  renameButton()?.click()
  await submitDialog('验收画布')
  await waitFor(() => boardName() === '验收画布', '画布改回原名')
  naming.renamed = true

  const choose = async (value, expected) => {
    addSelect.value = value
    addSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => nodeList().length >= expected, `添加卡片 ${value}`)
    await sleep(80)
  }

  await choose('doc:doc-canvas-1', 1)
  await choose('excerpt:ex-1', 2)
  await choose('chat:chat-1|msg-1', 3)
  addSelect.value = '__section'
  addSelect.dispatchEvent(new Event('change', { bubbles: true }))
  await submitDialog('问题定义')
  await waitFor(() => nodeList().length >= 4, '添加分区')
  naming.section = true
  await sleep(80)

  const byKind = (kind) => nodeList().find((node) => node.dataset.nodeKind === kind)
  await dragBy(byKind('document'), -420, -120)
  await dragBy(byKind('excerpt'), 20, -120)
  await dragBy(byKind('chat'), -420, 140)
  await dragBy(byKind('section'), 20, 140)

  const cards = nodeList().map((node) => ({
    kind: node.dataset.nodeKind,
    text: node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  }))

  const beforeResize = styleBox(byKind('document'))
  await resizeBy(byKind('document'), 90, 60)
  const afterResize = styleBox(byKind('document'))

  await dragBy(byKind('excerpt'), 100, 320)
  const excerptBeforeSectionDrag = styleBox(byKind('excerpt'))
  await dragBy(byKind('section'), -60, 40)
  const excerptAfterSectionDrag = styleBox(byKind('excerpt'))
  const sectionBeforeResize = styleBox(byKind('section'))
  await resizeBy(byKind('section'), 40, 30)
  const sectionAfterResize = styleBox(byKind('section'))

  document.querySelector('[data-canvas-docs]').click()
  const dragSource = await waitFor(() => document.querySelector('[data-canvas-doc-source="doc-canvas-1"]'), '文献面板')
  const transfer = new DataTransfer()
  dragSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  const dropRect = document.querySelector('[data-canvas-surface]').getBoundingClientRect()
  const dropX = dropRect.left + dropRect.width - 320
  const dropY = dropRect.top + 180
  const surface = document.querySelector('[data-canvas-surface]')
  surface.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: dropX, clientY: dropY }))
  surface.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: dropX, clientY: dropY }))
  const nodeCountAfterDrop = await waitFor(() => (nodeList().length === 5 ? nodeList().length : 0), '文献拖入画布')

  document.querySelector('[data-canvas-connect]').click()
  await waitFor(() => document.querySelector('[data-canvas-connect]')?.classList.contains('active'), '连线模式')
  await sleep(120)
  pointerDown(nodeList()[0])
  await sleep(120)
  pointerDown(nodeList()[1])
  const edgeAfterConnect = await waitFor(() => edgeList().length === 1, '创建连线')

  const hitLine = document.querySelector('[data-canvas-edge] line:nth-child(2)')
  hitLine.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const edgeAfterDelete = await waitFor(() => edgeList().length === 0, '删除连线')

  await sleep(120)
  pointerDown(nodeList()[0])
  await sleep(120)
  pointerDown(nodeList()[1])
  const edgeAfterReconnect = await waitFor(() => edgeList().length === 1, '重新连线')

  await waitFor(() => zoomText() === '100%', '初始缩放')
  document.querySelector('[data-canvas-zoom-in]').click()
  document.querySelector('[data-canvas-zoom-in]').click()
  const zoomButton = await waitFor(() => (zoomText() === '144%' ? zoomText() : ''), '按钮缩放')

  const rect = surface.getBoundingClientRect()
  surface.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    })
  )
  const zoomWheel = await waitFor(() => (zoomText() === '158%' ? zoomText() : ''), '滚轮缩放')

  const panBefore = worldTransform()
  const startX = rect.left + rect.width / 2
  const startY = rect.top + rect.height / 2
  surface.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, clientX: startX, clientY: startY })
  )
  surface.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, clientX: startX + 140, clientY: startY + 90 })
  )
  surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true }))
  const panAfter = await waitFor(() => (worldTransform() !== panBefore ? worldTransform() : ''), '平移画布')

  document.querySelector('[data-canvas-zoom-reset]').click()
  await waitFor(() => zoomText() === '100%', '重置视图')

  window.__CANVAS_EXPORT__ = null
  const originalClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      window.__CANVAS_EXPORT__ = { download: this.download, href: this.href }
      return
    }
    return originalClick.call(this)
  }
  document.querySelector('[data-canvas-export]').click()
  const exported = await waitFor(() => window.__CANVAS_EXPORT__, '导出 PNG')
  HTMLAnchorElement.prototype.click = originalClick

  await sleep(600)
  window.confirm = originalConfirm
  Element.prototype.setPointerCapture = originalCapture

  return {
    view: 'canvas-phase1',
    sidebarActive: sidebar.active,
    boardName: boardName(),
    naming,
    cards,
    edgeAfterConnect: edgeAfterConnect === true,
    edgeAfterDelete: edgeAfterDelete === true,
    edgeAfterReconnect: edgeAfterReconnect === true,
    zoomButton,
    zoomWheel,
    panChanged: panBefore !== panAfter,
    resize: {
      before: beforeResize,
      after: afterResize,
      ok: afterResize.width > beforeResize.width + 85 && afterResize.height > beforeResize.height + 55
    },
    section: {
      excerptDelta: {
        x: excerptAfterSectionDrag.left - excerptBeforeSectionDrag.left,
        y: excerptAfterSectionDrag.top - excerptBeforeSectionDrag.top
      },
      resizeOk: sectionAfterResize.width > sectionBeforeResize.width + 35 && sectionAfterResize.height > sectionBeforeResize.height + 25,
      ok:
        Math.abs(excerptAfterSectionDrag.left - excerptBeforeSectionDrag.left + 60) < 1.5 &&
        Math.abs(excerptAfterSectionDrag.top - excerptBeforeSectionDrag.top - 40) < 1.5
    },
    libraryDrop: {
      count: nodeCountAfterDrop,
      documents: nodeList().filter((node) => node.dataset.nodeKind === 'document').length
    },
    export: {
      download: exported.download,
      isPngDataUrl: exported.href.startsWith('data:image/png;base64,'),
      bytes: exported.href.length
    }
  }
}

const phaseTwo = async () => {
  const sidebar = await openCanvasFromSidebar()
  await waitFor(() => nodeList().length === 5, '重启后画布卡片')
  return {
    view: 'canvas-phase2',
    sidebarActive: sidebar.active,
    boardName: boardName(),
    cards: nodeList().map((node) => ({
      kind: node.dataset.nodeKind,
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    })),
    docWidths: nodeList()
      .filter((node) => node.dataset.nodeKind === 'document')
      .map((node) => Number.parseFloat(node.style.width)),
    edges: edgeList().length
  }
}

const phase = window.__CANVAS_PHASE__ === 2 ? phaseTwo : phaseOne
try {
  return await phase()
} catch (error) {
  return { view: 'canvas-error', error: error?.message || String(error), zoom: zoomText() }
}
