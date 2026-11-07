const insertButton = Array.from(document.querySelectorAll('.inbox-editor-toolbar button')).find((button) => button.innerText.includes('插入图片'))
insertButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
document.querySelector('.attachment-pick-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const saveButton = Array.from(document.querySelectorAll('.inbox-editor-modal .modal-actions button')).find((button) => button.innerText.trim() === '保存')
saveButton?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const listImage = document.querySelector('.inbox-content img')
const state = await window.api.library.getState()
const item = state.inbox[0]
return {
  saved: !document.querySelector('.inbox-editor-modal'),
  contentHasPath: item?.content.includes('zotfile://attachments/') ?? false,
  listImageLoaded: Boolean(listImage && listImage.complete && listImage.naturalWidth > 0),
  listImageSrc: listImage?.getAttribute('src') ?? null,
  attachments: item?.attachments?.map((entry) => entry.name) ?? []
}
