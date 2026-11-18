import { getLocale, localeFromStored, localeTag, setLocale, subscribeLocale, t } from '@shared/i18n'

/** All renderer windows share saved locale; update existing controls without remounting editors. */
export function installUiLocale(title: string): void {
  try { setLocale(localeFromStored(localStorage.getItem('arbor-locale'))) } catch { /* Optional startup cache. */ }
  const apply = (): void => {
    document.documentElement.lang = localeTag(getLocale())
    document.title = t(title)
    try { localStorage.setItem('arbor-locale', getLocale()) } catch { /* Optional startup cache. */ }
  }
  subscribeLocale(apply)
  apply()
  let receivedSettings = false
  window.api.events.onSettingsChanged(settings => { receivedSettings = true; setLocale(settings.language); apply() })
  void window.api.library.getState().then(data => { if (!receivedSettings) { setLocale(data.settings.language); apply() } }).catch(() => undefined)
}
