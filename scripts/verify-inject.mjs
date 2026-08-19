/**
 * Drive dsh web with Edge (puppeteer-core) to inspect the injector.
 * Prints every button's aria-label/text so selectors are evidence-based.
 */
import puppeteer from 'puppeteer-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = process.env.DSH_URL ?? 'http://127.0.0.1:8090'

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu',
    // Isolated profile: without it, headless Edge attaches to the user's
    // running session and opens the wrong window.
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bre-verify-'))}`,
  ],
})
const page = await browser.newPage()
console.log('initial url:', page.url())
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
console.log('after goto url:', page.url())
console.log('title:', await page.title())
await new Promise(r => setTimeout(r, 3000))
console.log('after 3s url:', page.url())
console.log('frames:', page.frames().map(f => f.url()))

// 打印所有按钮，找“设置”
const buttons = await page.$$eval('button', els => els.slice(0, 40).map(b => ({
  text: (b.textContent || '').trim().slice(0, 25),
  aria: b.getAttribute('aria-label'),
  title: b.getAttribute('title'),
})))
console.log('=== buttons ===')
console.log(JSON.stringify(buttons, null, 1))

// 按文本找并点击（宽松）
const clickByText = async (text, wait = 700) => {
  const el = await page.evaluateHandle((t) => {
    const btns = Array.from(document.querySelectorAll('button'))
    return btns.find(b => (b.textContent || '').trim() === t) ?? btns.find(b => (b.textContent || '').trim().startsWith(t)) ?? null
  }, text)
  const handle = el.asElement()
  if (!handle) { console.log(`[skip] ${text}`); return false }
  await handle.click().catch(e => console.log(`[click-err] ${text}: ${e.message}`))
  await new Promise(r => setTimeout(r, wait))
  return true
}

await clickByText('设置')
await clickByText('模型')
await clickByText('编辑 商汤')
await clickByText('自定义设置')
await clickByText('容量 1')
await new Promise(r => setTimeout(r, 2000))

const out = {}
out.breEditors = await page.$$eval('.bre-effort-editor', els => els.length)
out.dbg = await page.$eval('#bre-dbg', el => el.textContent).catch(() => '(no dbg div)')
out.editorText = await page.$eval('.bre-effort-editor', el => (el.textContent || '').slice(0, 150)).catch(() => '(none)')
console.log('=== RESULT ===')
console.log(JSON.stringify(out, null, 2))
await browser.close()
