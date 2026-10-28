#!/usr/bin/env node
import { snippet, dailyReport, formatReport } from '../src/index.js'

const usage = `Usage:
  privatus-ghost snippet pa_YOURSITEID [--no-member-events]
      Print the code to paste into Ghost: Settings > Code injection > Site header.

  PRIVATUS_TOKEN=pat_... privatus-ghost report pa_YOURSITEID [--json]
      Print yesterday's numbers from the Privatus Analytics API.`

const [cmd, siteId, ...flags] = process.argv.slice(2)

try {
  if (cmd === 'snippet' && siteId) {
    console.log(snippet({ siteId, memberEvents: !flags.includes('--no-member-events') }))
  } else if (cmd === 'report' && siteId) {
    const report = await dailyReport({ token: process.env.PRIVATUS_TOKEN, siteId })
    console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report))
  } else {
    console.log(usage)
    process.exitCode = cmd ? 1 : 0
  }
} catch (err) {
  console.error(err.message)
  process.exitCode = 1
}
