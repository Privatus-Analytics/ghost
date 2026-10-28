/**
 * Privatus Analytics for Ghost.
 *
 * Two parts, no dependencies:
 *  - snippet(): the HTML a Ghost site pastes into Settings > Code injection > Site header.
 *    It loads the cookieless tracker and records Ghost member events (newsletter sign-ups,
 *    new members, sign-ins and paid subscriptions).
 *  - dailyReport() and formatReport(): read yesterday's numbers from the Privatus Analytics
 *    API, for a daily email or a dashboard inside a Ghost add-on.
 */

export const SITE_ID_PATTERN = /^pa_[A-Za-z0-9]+$/
export const DEFAULT_MODULES = ['engage', 'auto', 'vitals', 'clicks', 'ask']
export const SCRIPT_SRC = 'https://privatusstats.com/js/pa.js'
export const API_BASE = 'https://privatusanalytics.com'
const MODULE_PATTERN = /^[a-z][a-z0-9_-]*$/

/** The names of the events the Ghost script records. */
export const GHOST_EVENTS = {
  formSent: 'Newsletter signup',
  memberSignup: 'Member signup',
  memberSignin: 'Member sign-in',
  paidSubscription: 'Paid subscription'
}

const QUEUE_STUB =
  "window.privatus=window.privatus||{q:[]};['track','pageview','props','optOut','optIn','ready']" +
  '.forEach(function(m){window.privatus[m]=window.privatus[m]||function(){window.privatus.q.push(' +
  '[m,Array.prototype.slice.call(arguments)])}});'

/** Throws unless the value is a Privatus Analytics site ID such as pa_7Q2K9XH3AB. */
export function assertSiteId(siteId) {
  if (typeof siteId !== 'string' || !SITE_ID_PATTERN.test(siteId.trim())) {
    throw new TypeError('A Privatus Analytics site ID starts with pa_ followed by letters and numbers.')
  }
  return siteId.trim()
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Inline JavaScript that records Ghost member events. It only reads the page address and
 * which Ghost form was sent. It never reads an email address or any other form field.
 */
export function ghostEventsScript(events = GHOST_EVENTS) {
  const names = JSON.stringify(events).replace(/</g, '\\u003c')
  return (
    '(function(){var E=' + names + ';' +
    'function t(n,p){try{window.privatus.track(n,p)}catch(e){}}' +
    // Ghost sends a sign-in link by email after these forms. Record that the form was sent.
    "document.addEventListener('submit',function(e){var f=e.target;" +
    "if(!f||!f.closest)return;f=f.closest('form[data-members-form]');if(!f)return;" +
    "var k=f.getAttribute('data-members-form')||'signup';" +
    "if(k==='signin')return;t(E.formSent,{form:k})},true);" +
    // Ghost adds these to the address after the reader clicks the link or pays.
    'var s;try{s=new URLSearchParams(window.location.search)}catch(e){return}' +
    "var a=s.get('action'),ok=s.get('success')==='true';" +
    "if(ok&&(a==='signup'||a==='subscribe'))t(E.memberSignup);" +
    "else if(ok&&a==='signin')t(E.memberSignin);" +
    "if(s.get('stripe')==='success')t(E.paidSubscription)" +
    '})();'
  )
}

/**
 * The HTML for Ghost's Site header code injection.
 * @param {{siteId: string, modules?: string[], memberEvents?: boolean}} options
 */
export function snippet({ siteId, modules = DEFAULT_MODULES, memberEvents = true } = {}) {
  const id = assertSiteId(siteId)
  const list = (Array.isArray(modules) ? modules : String(modules).split(','))
    .map((m) => String(m).trim())
    .filter((m) => MODULE_PATTERN.test(m))
  const tag =
    `<script defer src="${SCRIPT_SRC}" data-site="${escapeHtml(id)}"` +
    (list.length ? ` data-modules="${escapeHtml(list.join(','))}"` : '') +
    '></script>'
  if (!memberEvents) return tag
  return `${tag}\n<script>${QUEUE_STUB}${ghostEventsScript()}</script>`
}

function query(params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v))
  return q.toString()
}

/** A tiny client for the parts of the Privatus Analytics API a daily report needs. */
export function createClient({ token, fetch: fetchImpl = globalThis.fetch, baseUrl = API_BASE } = {}) {
  if (typeof token !== 'string' || !token.startsWith('pat_')) {
    throw new TypeError('An API token from Privatus Analytics starts with pat_.')
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('No fetch function is available.')
  return async function get(path, params = {}) {
    const res = await fetchImpl(`${baseUrl}${path}?${query(params)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    })
    if (!res.ok) {
      const err = new Error(`Privatus Analytics API returned ${res.status} for ${path}`)
      err.status = res.status
      throw err
    }
    const body = await res.json()
    return body && typeof body === 'object' && 'data' in body ? body.data : body
  }
}

function rows(data) {
  return Array.isArray(data?.rows) ? data.rows : []
}

/**
 * Yesterday's numbers for one site, compared with the day before.
 * @param {{token: string, siteId: string, period?: string, limit?: number, fetch?: Function}} options
 */
export async function dailyReport({ token, siteId, period = 'yesterday', limit = 5, fetch, baseUrl } = {}) {
  const id = encodeURIComponent(assertSiteId(siteId))
  const get = createClient({ token, fetch, baseUrl })
  const base = { period }
  const [aggregate, pages, sources, events] = await Promise.all([
    get(`/sites/${id}/stats/aggregate.json`, { ...base, compare: 'previous_period' }),
    get(`/sites/${id}/breakdown/page.json`, { ...base, limit }),
    get(`/sites/${id}/breakdown/channel.json`, { ...base, limit }),
    get(`/sites/${id}/breakdown/event.json`, { ...base, limit: 100 })
  ])
  const ghostNames = new Set(Object.values(GHOST_EVENTS))
  const ghostEvents = {}
  for (const row of rows(events)) {
    if (ghostNames.has(row.value)) ghostEvents[row.value] = row.completions ?? row.visitors ?? 0
  }
  return {
    siteId: decodeURIComponent(id),
    period: aggregate?.period ?? null,
    metrics: aggregate?.metrics ?? {},
    change: aggregate?.change ?? {},
    topPages: rows(pages).map((r) => ({ page: r.value, pageviews: r.pageviews ?? 0 })),
    topSources: rows(sources).map((r) => ({ source: r.value, visitors: r.visitors ?? 0 })),
    ghostEvents
  }
}

function change(pct) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return ''
  const n = Math.round(Number(pct))
  return ` (${n > 0 ? '+' : ''}${n}%)`
}

/** Plain text for an email or a log line. */
export function formatReport(report) {
  const m = report.metrics || {}
  const c = report.change || {}
  const lines = [
    `Privatus Analytics report for ${report.siteId}` +
      (report.period?.from ? ` (${report.period.from}${report.period.to && report.period.to !== report.period.from ? ` to ${report.period.to}` : ''})` : ''),
    '',
    `Visitors: ${m.visitors ?? 0}${change(c.visitors)}`,
    `Page views: ${m.pageviews ?? 0}${change(c.pageviews)}`
  ]
  const ev = Object.entries(report.ghostEvents || {})
  if (ev.length) {
    lines.push('', 'Members:')
    for (const [name, n] of ev) lines.push(`  ${name}: ${n}`)
  }
  if (report.topPages?.length) {
    lines.push('', 'Top pages:')
    for (const p of report.topPages) lines.push(`  ${p.page}  ${p.pageviews}`)
  }
  if (report.topSources?.length) {
    lines.push('', 'Where visitors came from:')
    for (const s of report.topSources) lines.push(`  ${s.source}  ${s.visitors}`)
  }
  return lines.join('\n')
}
