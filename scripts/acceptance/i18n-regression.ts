import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { app } from 'electron'
import { EN } from '../../src/shared/i18n/en'
import { displayChatTitle, setLocale, t } from '../../src/shared/i18n'

function run(): void {
  const missing: string[] = []
  function requireEnglish(value: string, file: string): void {
    if (/[\u4e00-\u9fff]/.test(value) && !EN[value]) missing.push(`${file}: ${value}`)
  }
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      if (!/\.tsx?$/.test(file)) continue
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) requireEnglish(node.arguments[0].text, file)
        if (ts.isJsxText(node) && /[\u4e00-\u9fff]/.test(node.text)) missing.push(`${file}: untranslated JSX ${node.text}`)
        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
          if (node.parent.parent.tagName.getText(source) === 'SettingsSection') requireEnglish(node.initializer.text, file)
          else if (/[\u4e00-\u9fff]/.test(node.initializer.text)) missing.push(`${file}: untranslated attribute ${node.initializer.text}`)
        }
        // Main-process tool schemas contain model instructions, rather than visible UI labels.
        if (!file.startsWith(path.join('src', 'main')) && ts.isPropertyAssignment(node) && /^(label|title|name|description|hint)$/.test(node.name.getText(source)) && ts.isStringLiteralLike(node.initializer)) requireEnglish(node.initializer.text, file)
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  for (const dir of ['src/renderer/src', 'src/main', 'src/shared']) walk(dir)
  assert.deepEqual(missing, [])
  setLocale('en')
  assert.equal(t('API 密钥'), 'API key')
  assert.equal(t('细'), 'Thin')
  assert.equal(displayChatTitle('新的对话'), 'New chat')
  assert.equal(displayChatTitle('我的研究'), '我的研究')
  setLocale('zh-TW')
  assert.equal(t('API 密钥'), 'API 金鑰')
  assert.equal(displayChatTitle('New chat'), '新的對話')
  setLocale('zh-CN')
  assert.equal(displayChatTitle('New chat'), '新的对话')
  console.log('PASS: built-in UI literals, settings descriptions and resource labels have English translations; locale switches preserve authored titles')
}
app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
