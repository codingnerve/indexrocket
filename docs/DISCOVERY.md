# Discovery is not indexing

IndexRocket never claims that a URL is indexed. This document defines the four
concepts the codebase keeps strictly separate, and the vocabulary every status
field, log line and API response must use.

## The four stages

| Stage | Who does it | What IndexRocket knows | Status vocabulary |
|---|---|---|---|
| **Inspection** | IndexRocket | Everything — we made the request ourselves | `queued`, `processing`, `inspected`, `failed` |
| **Discovery notification** | IndexRocket → search engine | Only that the notification was accepted | `not_submitted`, `pending`, `accepted`, `failed` |
| **Crawling** | The search engine | Nothing, unless the engine reports it | *not modelled yet* |
| **Indexing** | The search engine | Nothing, unless verified by a real indexing-status API | *not modelled yet* |

### 1. Inspection

We fetch the URL ourselves and record what we observed: HTTP status, final URL
after redirects, content type, canonical tag, robots.txt evaluation, sitemap
membership. These are **our own measurements**. `status: "inspected"` means
"we looked at it", nothing more.

### 2. Discovery notification

We tell a search engine that a URL exists or changed, using a protocol such as
IndexNow. `indexNowStatus: "accepted"` means exactly one thing:

> The provider returned HTTP 200 or 202 — the notification was well-formed and
> our key verified.

It does **not** mean the engine fetched the URL, will fetch it, or will index it.
A provider is free to ignore the notification entirely.

### 3. Crawling

The search engine decides whether and when to fetch the URL. We have no
visibility into this. Nothing in the database represents it.

### 4. Indexing

The search engine decides whether to put the URL in its index. This can only be
established through a legitimate indexing-status mechanism. Until such a
mechanism is implemented and verified, **no code path may set `status: "indexed"`.**

## Rules for contributors

- Never write `indexed` or `not_indexed` as a consequence of inspection or of a
  discovery notification. Those enum values exist for a later step and are
  currently never written.
- Never describe a provider's HTTP 200 as "submitted to Google", "indexed", or
  "guaranteed". The accurate phrase is **"notification accepted"**.
- `submitted`, `notified`, `discovered`, `crawled` and `indexed` are five
  different things. Do not use them interchangeably in code, logs, or UI copy.
- User-facing copy must not promise indexing. Discovery improves the odds that a
  URL is found sooner; it guarantees nothing.

## Eligibility rules

A URL is announced only when all of these hold (see
`packages/utils/src/discovery/eligibility.ts`):

- `status === "inspected"` — a failed inspection is never announced, so invalid
  URLs, SSRF-blocked hosts, DNS failures and timeouts never reach a provider.
- The recorded HTTP status is `2xx` (added/updated) or `404`/`410` (removed).
  Both are legitimate IndexNow notifications; anything else leaves the page's
  true state unestablished, so it is not announced.
- The URL's host matches the project domain (see the host rule below).
- The project has an IndexNow key configured.
- The URL was not already accepted within the cooldown window (24h).

robots.txt is deliberately **not** an eligibility gate. Our robots result is
evaluated for the `IndexRocketBot` token only, which says nothing about whether
search engines are permitted to crawl the URL — using it here would infer the
wrong thing.

## Host rule

A URL may be notified for a project only when its hostname is exactly the
project's domain, or that domain with a `www.` prefix. The two are treated as
equivalent because sites routinely serve both.

Any other subdomain (`blog.example.com`) is a **different host**: IndexNow
requires the key file to be published on the host being notified, so a subdomain
needs its own project and its own key. This is enforced in
`packages/utils/src/url/host.ts` and re-checked inside the provider.
