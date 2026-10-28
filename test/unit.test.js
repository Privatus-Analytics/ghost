import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { snippet, ghostEventsScript, dailyReport, formatReport, assertSiteId, GHOST_EVENTS } from '../src/index.js'

test('snippet has the tracker tag with the site ID and default modules', () => {
  const html = snippet({ siteId: 'pa_ABC123' })
  assert.match(
    html,
    /^<script defer src="https:\/\/privatusstats\.com\/js\/pa\.js" data-site="pa_ABC123" data-modules="engage,auto,vitals,clicks,ask"><\/script>\n<script>/
  )
  assert.ok(html.includes("window.privatus=window.privatus||{q:[]}"))
})

test('snippet without member events is only the tracker tag', () => {
  assert.equal(
    snippet({ siteId: 'pa_X1', memberEvents: false, modules: ['engage'] }),
    '<script defer src="https://privatusstats.com/js/pa.js" data-site="pa_X1" data-modules="engage"></script>'
  )
})

test('snippet drops module names that are not plain words', () => {
  const html = snippet({ siteId: 'pa_X1', memberEvents: false, modules: ['engage', '"><img>', 'auto'] })
  assert.ok(html.includes('data-modules="engage,auto"'))
  assert.ok(!html.includes('<img'))
})

test('bad site IDs are refused', () => {
  for (const bad of ['', 'pa_', 'abc', 'pa_a"b', 'pa_<x>', 'pa_a b', null, 42]) {
    assert.throws(() => snippet({ siteId: bad }), TypeError)
  }
  assert.equal(assertSiteId('  pa_ok9 '), 'pa_ok9')
})

function runEvents({ search = '', forms = [] } = {}) {
  const calls = []
  const listeners = []
  const window = {
    location: { search },
    privatus: { track: (name, props) => calls.push([name, props]) }
  }
  const document = { addEventListener: (type, fn) => listeners.push([type, fn]) }
  vm.runInNewContext(ghostEventsScript(), { window, document, URLSearchParams })
  for (const kind of forms) {
    const form = {
      getAttribute: (a) => (a === 'data-members-form' ? kind : null),
      closest: (sel) => (sel === 'form[data-members-form]' && kind !== undefined ? form : null)
    }
    for (const [type, fn] of listeners) if (type === 'submit') fn({ target: form })
  }
  return JSON.parse(JSON.stringify(calls))
}

test('a sent signup or subscribe form is recorded, a sign-in form is not', () => {
  assert.deepEqual(runEvents({ forms: ['signup', 'subscribe', 'signin'] }), [
    [GHOST_EVENTS.formSent, { form: 'signup' }],
    [GHOST_EVENTS.formSent, { form: 'subscribe' }]
  ])
})

test('Ghost return addresses become member events', () => {
  assert.deepEqual(runEvents({ search: '?action=signup&success=true' }), [[GHOST_EVENTS.memberSignup, null]])
  assert.deepEqual(runEvents({ search: '?action=subscribe&success=true' }), [[GHOST_EVENTS.memberSignup, null]])
  assert.deepEqual(runEvents({ search: '?action=signin&success=true' }), [[GHOST_EVENTS.memberSignin, null]])
  assert.deepEqual(runEvents({ search: '?stripe=success' }), [[GHOST_EVENTS.paidSubscription, null]])
  assert.deepEqual(runEvents({ search: '?action=signup&success=false' }), [])
  assert.deepEqual(runEvents({ search: '?stripe=cancel' }), [])
})

test('a broken tracker never breaks the page', () => {
  const window = { location: { search: '?stripe=success' }, privatus: { track() { throw new Error('x') } } }
  assert.doesNotThrow(() =>
    vm.runInNewContext(ghostEventsScript(), { window, document: { addEventListener() {} }, URLSearchParams })
  )
})

function fakeFetch(responses) {
  const seen = []
  const fn = async (url, init) => {
    seen.push({ url, init })
    const path = new URL(url).pathname
    const body = responses[path]
    if (!body) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ data: body, meta: {} }) }
  }
  fn.seen = seen
  return fn
}

test('dailyReport reads the API and keeps only Ghost events', async () => {
  const fetch = fakeFetch({
    '/sites/pa_A1/stats/aggregate.json': {
      period: { from: '2026-10-27', to: '2026-10-27' },
      metrics: { visitors: 120, pageviews: 300 },
      change: { visitors: 20, pageviews: -5.4 }
    },
    '/sites/pa_A1/breakdown/page.json': { rows: [{ value: '/welcome/', pageviews: 80 }] },
    '/sites/pa_A1/breakdown/channel.json': { rows: [{ value: 'organic_search', visitors: 60 }] },
    '/sites/pa_A1/breakdown/event.json': {
      rows: [
        { value: 'Newsletter signup', completions: 7 },
        { value: 'Outbound link', completions: 40 },
        { value: 'Paid subscription', completions: 1 }
      ]
    }
  })
  const report = await dailyReport({ token: 'pat_test', siteId: 'pa_A1', fetch })
  assert.equal(fetch.seen.length, 4)
  for (const { url, init } of fetch.seen) {
    assert.ok(url.startsWith('https://privatusanalytics.com/sites/pa_A1/'))
    assert.ok(url.includes('period=yesterday'))
    assert.equal(init.headers.Authorization, 'Bearer pat_test')
  }
  assert.ok(fetch.seen[0].url.includes('compare=previous_period'))
  assert.deepEqual(report.ghostEvents, { 'Newsletter signup': 7, 'Paid subscription': 1 })
  assert.deepEqual(report.topPages, [{ page: '/welcome/', pageviews: 80 }])

  const text = formatReport(report)
  assert.match(text, /Privatus Analytics report for pa_A1 \(2026-10-27\)/)
  assert.match(text, /Visitors: 120 \(\+20%\)/)
  assert.match(text, /Page views: 300 \(-5%\)/)
  assert.match(text, /Newsletter signup: 7/)
  assert.match(text, /organic_search {2}60/)
})

test('dailyReport refuses bad tokens and reports API errors', async () => {
  await assert.rejects(dailyReport({ token: 'nope', siteId: 'pa_A1', fetch: fakeFetch({}) }), TypeError)
  await assert.rejects(dailyReport({ token: 'pat_x', siteId: 'pa_A1', fetch: fakeFetch({}) }), /returned 404/)
})
