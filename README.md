# Privatus Analytics for Ghost

**See how your Ghost site and newsletter grow, with no cookie pop-up and no bots in your numbers.**

Many analytics tools put cookies on your readers. In many countries that means a
pop-up, and a lot of readers leave or say no. Bots also visit your posts, so the
numbers look bigger than they are. And the most useful number for a newsletter,
how many people signed up, is not in most reports at all.

Privatus Analytics counts visits without cookies, so there is no pop-up for your
analytics. It leaves bots out. With this package it also counts new members,
sign-ups and paid subscriptions on your Ghost site.

**Free plan, no card:** 10,000 events a month (an event is a page view or an action
you track) on up to 3 sites. [Start free at privatusanalytics.com](https://privatusanalytics.com).

## What is in here

1. **A snippet for Ghost.** Paste it once and your site is counted. It also records
   these member events:

   | Event | When |
   |---|---|
   | `Newsletter signup` | A reader sends a sign-up or subscribe form on your site |
   | `Member signup` | A new member clicks the link in their welcome email and lands back on your site |
   | `Member sign-in` | A member signs in with the emailed link |
   | `Paid subscription` | A member finishes paying and comes back to your site |

   It never reads email addresses or anything typed into a form.

2. **A daily report.** A small script (and a library) that reads yesterday's
   numbers from the Privatus Analytics API: visitors, page views, top pages, where
   visitors came from and the member events above. Use it for a daily email, or
   inside a Ghost add-on or dashboard.

## Add it to your Ghost site

1. In Privatus Analytics, add your site and copy its site ID (it starts with `pa_`).
2. Make your snippet. With Node.js:

   ```sh
   npx @privatus-analytics/ghost snippet pa_YOURSITEID
   ```

   Or copy the tag below and replace `pa_YOURSITEID` (this one has no member events):

   ```html
   <script defer src="https://privatusstats.com/js/pa.js" data-site="pa_YOURSITEID" data-modules="engage,auto,vitals,clicks,ask"></script>
   ```

3. In Ghost Admin, open **Settings**, then **Code injection**, then **Open**.
4. Paste the snippet into **Site header** and click **Save**.

Visit your site, then open Privatus Analytics. Your visit shows up within a minute.
To turn the member events into goals, add a goal for each event name in your site's
**Goals** page.

## Daily report

Make an API token in Privatus Analytics (the [API docs](https://privatusanalytics.com/docs/api) show where). It
starts with `pat_`.

```sh
PRIVATUS_TOKEN=pat_... npx @privatus-analytics/ghost report pa_YOURSITEID
```

```text
Privatus Analytics report for pa_YOURSITEID (2026-10-27)

Visitors: 120 (+20%)
Page views: 300 (-5%)

Members:
  Newsletter signup: 7
  Paid subscription: 1

Top pages:
  /welcome/  80

Where visitors came from:
  organic_search  60
```

Add `--json` for data you can use in your own code.

### As a library

```js
import { snippet, dailyReport, formatReport } from '@privatus-analytics/ghost'

const html = snippet({ siteId: 'pa_YOURSITEID' }) // checks the ID and escapes it
const report = await dailyReport({ token: process.env.PRIVATUS_TOKEN, siteId: 'pa_YOURSITEID' })
console.log(formatReport(report))
```

`dailyReport` uses these API calls, so a Ghost add-on can call them directly too:

- `GET /sites/{site_id}/stats/aggregate.json?period=yesterday&compare=previous_period`
- `GET /sites/{site_id}/breakdown/page.json?period=yesterday`
- `GET /sites/{site_id}/breakdown/channel.json?period=yesterday`
- `GET /sites/{site_id}/breakdown/event.json?period=yesterday`

Each one takes an `Authorization: Bearer pat_...` header. The full list is in the
[API docs](https://privatusanalytics.com/docs/api) and the
[OpenAPI file](https://privatusanalytics.com/openapi.json). There is also an
[MCP server](https://github.com/Privatus-Analytics/mcp-server) so AI assistants
can read the same numbers.

## Tests

```sh
npm test          # unit tests, no network
npm run test:e2e  # starts a real Ghost 6 in Docker, saves the snippet in Code injection
                  # through the Ghost Admin API, then checks the pages in Chromium
```

## Links

- [Ghost install guide](https://privatusanalytics.com/docs/install/ghost)
- [Custom events](https://privatusanalytics.com/docs)
- Help: hello@privatusanalytics.com

## License

MIT, Two Phase LLC. See [LICENSE](LICENSE).
