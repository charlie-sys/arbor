const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..')
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}svg{width:1024px;height:1024px;display:block}</style></head><body>${svg}</body></html>`
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), image.toPNG())
  win.destroy()
  app.quit()
})
