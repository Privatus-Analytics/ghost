// Runs inside the Playwright container. Ghost runs in a throwaway container on a private
// Docker network, so the owner account below exists only for this test.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { snippet, GHOST_EVENTS } from '/pkg/src/index.js'

const GHOST = process.env.GHOST_URL
const OWNER = { name: 'Test Owner', email: 'owner@example.test', password: 'e2e-only-' + Math.random().toString(36).slice(2) + 'Aa1!' }
const SITE_ID = 'pa_E2ETEST1'

async function waitForGhost() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${GHOST}/ghost/api/admin/site/`)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Ghost did not start')
}

async function admin(path, { method = 'GET', body, cookie } = {}) {
  const r = await fetch(`${GHOST}/ghost/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: GHOST, ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`)
  return r
}

await waitForGhost()
console.log('Ghost is up')
await admin('/authentication/setup/', {
  method: 'POST',
  body: { setup: [{ name: OWNER.name, email: OWNER.email, password: OWNER.password, blogTitle: 'E2E Blog' }] }
})
const login = await admin('/session/', { method: 'POST', body: { username: OWNER.email, password: OWNER.password } })
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const code = snippet({ siteId: SITE_ID })
await admin('/settings/', { method: 'PUT', cookie, body: { settings: [{ key: 'codeinjection_head', value: code }] } })
console.log('Snippet saved in Code injection')

const html = await (await fetch(`${GHOST}/`)).text()
assert.ok(html.includes(`data-site="${SITE_ID}"`), 'Ghost page has the tracker tag')
assert.ok(html.includes('data-modules="engage,auto,vitals,clicks,ask"'))
console.log('Ghost renders the tag in <head>')

const browser = await chromium.launch()
const page = await browser.newPage()
// Stand-in for pa.js: replays the queue into window.__calls like the real tracker does.
await page.route('https://privatusstats.com/js/pa.js', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body:
      'window.__calls=[];var s=document.currentScript;window.__site=s&&s.getAttribute("data-site");' +
      '(window.privatus.q||[]).forEach(function(c){window.__calls.push([c[0]].concat(c[1]))});' +
      'window.privatus={track:function(n,p){window.__calls.push(["track",n,p])}};'
  })
)
// Ghost would send a sign-in email after the form. Answer that request so no mail is needed.
await page.route('**/members/api/send-magic-link/**', (route) => route.fulfill({ status: 201, body: '{}' }))

async function calls(url) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Array.isArray(window.__calls))
  return page.evaluate(() => ({ site: window.__site, calls: window.__calls }))
}

let r = await calls(`${GHOST}/?action=signup&success=true`)
assert.equal(r.site, SITE_ID)
assert.equal(r.calls.length, 1)
assert.deepEqual(r.calls[0].slice(0, 2), ['track', GHOST_EVENTS.memberSignup])
console.log('New member return address recorded:', JSON.stringify(r.calls))

r = await calls(`${GHOST}/?stripe=success`)
assert.equal(r.calls[0][1], GHOST_EVENTS.paidSubscription)
console.log('Paid subscription recorded')

r = await calls(`${GHOST}/`)
assert.deepEqual(r.calls, [], 'a plain visit records no member event')
const form = page.locator('form[data-members-form]').first()
assert.ok((await form.count()) > 0, 'the Ghost theme has a members form')
await form.locator('input[type=email], input[data-members-email]').first().fill('reader@example.test')
await form.evaluate((f) => f.requestSubmit())
await page.waitForFunction(() => window.__calls.length > 0)
const sent = await page.evaluate(() => window.__calls)
assert.equal(sent[0][1], GHOST_EVENTS.formSent)
assert.ok(!JSON.stringify(sent).includes('reader@example.test'), 'the email address is never sent')
console.log('Newsletter form recorded without the email:', JSON.stringify(sent))

await browser.close()
console.log('E2E passed')
