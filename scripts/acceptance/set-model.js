await window.api.settings.save({
  apiBaseUrl: 'https://api.deepseek.com',
  apiKey: window.__TEST_API_KEY,
  chatModel: 'deepseek-flash',
  visionModel: 'deepseek-flash'
})
const state = await window.api.library.getState()
let test
try {
  test = await window.api.settings.test()
} catch (error) {
  test = { ok: false, message: String(error) }
}
return {
  savedBase: state.settings.apiBaseUrl,
  chatModel: state.settings.chatModel,
  visionModel: state.settings.visionModel,
  keyPresent: Boolean(state.settings.apiKey),
  test
}
