# IndexRocket — Web

The IndexRocket product UI: a Next.js 16 App Router application that talks to the
IndexRocket API (`apps/api`) with the browser's HttpOnly session cookie.

## Development

```bash
npm run dev --workspace=web      # http://localhost:3000, API expected at http://localhost:5000
```

`NEXT_PUBLIC_API_URL` selects the API. Development falls back to
`http://localhost:5000`; production reads the committed `.env.production`
(`https://api.theflyventures.com`) and never falls back to localhost. See
`docs/PRODUCTION.md` for the production build procedure.

## Structure

```
app/
  page.tsx                 public landing page (server component)
  (auth)/                  /login, /register — split-screen auth layout
  (app)/                   authenticated product, wrapped in the app shell
    dashboard/  projects/  urls/  submissions/  analytics/
    integrations/  google/  indexnow/  settings/
  components/ui/           design-system primitives (buttons, forms, tables, dialogs, toasts…)
  components/shell/        sidebar, mobile drawer, account menu, session gate
  components/status.tsx    the status vocabulary (see below)
  features/                reusable product pieces (URL table, batch table, dialogs, Google panel)
  lib/                     API client, response types, hooks, session, theme, formatting
```

- **Design tokens** live in `app/globals.css` as CSS variables and are exposed to
  Tailwind (`bg-card`, `text-muted`, `bg-primary`…). Light and dark themes are
  driven by the `data-theme` attribute.
- **Data**: `lib/api.ts` is the only HTTP client. `useResource` loads and
  optionally polls (only while real server-side work is running); `useAction`
  runs mutations with toasts and friendly error messages.
- **Auth**: the session cookie is scoped to the API host, so the app shell asks
  `/api/auth/me` and redirects to `/login` when there is no session. The API
  remains the security boundary; no token is ever stored in the browser.

## Status vocabulary

Three families are never merged:

| Family     | Source                    | Example labels                    |
| ---------- | ------------------------- | --------------------------------- |
| Inspection | IndexRocket's own checks  | Queued, Inspecting, Inspected     |
| Google     | Google Search Console     | Indexed, Not indexed, Not checked |
| IndexNow   | Notification acceptance   | Notified, Sending, Not notified   |

Only the Google family may say "Indexed". An accepted IndexNow notification is
shown as "Notified".
