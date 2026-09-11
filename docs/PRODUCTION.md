# IndexRocket — Production Deployment Guide (shared Contabo VPS)

This guide prepares IndexRocket for production on an **existing** Contabo VPS that
already serves **https://theflyventures.com**. Nothing here has been deployed; it
is the procedure and configuration to use when you do.

Config templates live in [`deploy/`](../deploy). No secret values appear anywhere
in this repository.

| | Production |
|---|---|
| Frontend | **https://app.theflyventures.com** → `127.0.0.1:3100` |
| API | **https://api.theflyventures.com** → `127.0.0.1:5101` |
| Google OAuth callback | **https://api.theflyventures.com/api/auth/google/callback** |
| Worker | internal only (health on `127.0.0.1:5100`) |
| Existing site | **https://theflyventures.com** — must remain untouched |

---

## 0. Shared-server rules (read first)

The VPS already runs theflyventures.com. Every step below is written so that the
existing site's configuration, certificate, ports and behaviour do not change.

**Never** during this deployment:

- edit `/etc/nginx/nginx.conf` or any existing file in `sites-available/`,
  `sites-enabled/` or `conf.d/`;
- delete `/etc/nginx/sites-enabled/default` or any other existing site;
- add `default_server`, or socket options such as `http2`, `backlog`, `reuseport`
  or `ipv6only`, to a `listen` line (they are per-socket, so they would change the
  existing site too);
- add global `http {}` directives (the IndexRocket common file defines only
  uniquely named `ir_*` / `indexrocket_*` objects);
- re-issue, expand or modify the existing theflyventures.com certificate
  (IndexRocket gets its own certificate, `--cert-name indexrocket`);
- change DNS records for `theflyventures.com` or `www.theflyventures.com`;
- change the global Redis or MongoDB configuration used by other apps (§3, §4);
- enable, reset or reorder the firewall (`ufw`) rules.

**Pre-flight (read-only) — record the current state before changing anything:**

```bash
# Ports IndexRocket needs must be free (expect no output)
sudo ss -tlnp | grep -E ':(3100|5100|5101|6380)\b'

# Nginx layout and a full snapshot of the running config
ls -l /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
grep -n "include" /etc/nginx/nginx.conf           # confirm sites-enabled/*.conf or conf.d/*.conf is included
sudo nginx -T > ~/nginx-before-indexrocket.txt 2>&1
grep -rn "app.theflyventures.com\|api.theflyventures.com" /etc/nginx || echo "no existing IndexRocket hostnames"
nginx -v

# Existing site fingerprint (compare after the deployment)
curl -sI https://theflyventures.com       > ~/theflyventures-before.txt
curl -sI https://www.theflyventures.com  >> ~/theflyventures-before.txt
echo | openssl s_client -connect theflyventures.com:443 -servername theflyventures.com 2>/dev/null \
  | openssl x509 -noout -subject -enddate -fingerprint -sha256 >> ~/theflyventures-before.txt
sudo certbot certificates

# Existing data services
systemctl status mongod redis-server --no-pager 2>/dev/null | grep -E "Loaded|Active"
sudo ufw status verbose
```

If `nginx.conf` includes only `conf.d/*.conf` (no `sites-enabled`), install the
site files into `/etc/nginx/conf.d/` with a `.conf` suffix instead of
`sites-available` + symlink.

## 1. Required infrastructure

| Component | Version | Role |
|---|---|---|
| Linux host | the existing Contabo VPS (Ubuntu 22.04 / 24.04 or equivalent) | Runs every service |
| Node.js | 22 LTS at `/usr/bin/node` | API, worker, frontend |
| MongoDB | 7.x or 8.x | Users, projects, URLs, batches, Google connections |
| Redis | **≥ 6.2** (7.x recommended), dedicated instance | BullMQ queues, sessions, OAuth state, throttles |
| Nginx | existing install | TLS termination, reverse proxy, edge rate limiting |
| Certbot | existing or current | Let's Encrypt certificate for the two new hostnames |
| systemd | — | Process supervision |

Topology (single host):

```
Internet ──443──> Nginx ─┬─> theflyventures.com       (existing site, unchanged)
                         ├─> 127.0.0.1:3100  Next.js       (app.theflyventures.com)
                         └─> 127.0.0.1:5101  Express API   (api.theflyventures.com)
                                   │
          Worker (no public port; health on 127.0.0.1:5100)
                                   │
          MongoDB 127.0.0.1:27017 (db "indexrocket")   Redis 127.0.0.1:6380 (dedicated)
```

Only ports **80** and **443** are public, and they are already open for the
existing site. MongoDB, Redis, the API (`HOST`, default `127.0.0.1` in
production), the frontend (`--hostname 127.0.0.1`) and the worker health
endpoint all bind to loopback. Ports 3100, 5100, 5101 and 6380 must **not** be
opened in the firewall.

**Cookies and origins.** The frontend and API are sibling subdomains of the same
registrable domain (`app.theflyventures.com` / `api.theflyventures.com`), so they
are *same-site*: the API's `SameSite=Lax` session cookie is sent on the
frontend's credentialed requests without weakening it to `SameSite=None`. The
cookie is **host-only** (no `Domain` attribute), so it is only ever sent to
`api.theflyventures.com` — never to theflyventures.com or app.theflyventures.com.
Because theflyventures.com is also same-site, `SameSite` alone would not stop it
from sending requests to the API; the API's exact-origin CORS and CSRF check
(`FRONTEND_URL=https://app.theflyventures.com`) does: requests with
`Origin: https://theflyventures.com` are rejected with 403 (covered by tests).

## 2. Environment variables

Secrets are supplied through systemd `EnvironmentFile`s, **not** `.env` files:

```bash
sudo install -d -m 0700 -o root -g root /etc/indexrocket
sudo install -m 0600 -o root -g root /dev/null /etc/indexrocket/api.env
sudo install -m 0600 -o root -g root /dev/null /etc/indexrocket/worker.env
sudoedit /etc/indexrocket/api.env      # then worker.env
```

systemd reads these files as root before starting the service, so the service
user needs no access to them. Format: one `NAME=value` per line, no `export`,
no quotes needed.

Do not place a `.env` file in the release directory. The apps load `.env` from
their working directory for local development, and a stray file there would be
merged into production config (EnvironmentFile values still take precedence).

### API (`/etc/indexrocket/api.env`) — template: `apps/api/.env.example`

| Variable | Required | Production value | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | Enables Secure cookies, hides stacks, enforces the checks below |
| `PORT` | yes (here) | `5101` | Nginx upstream `indexrocket_api` expects it. The unit also defaults it to 5101. Development default is 5000 |
| `HOST` | no | blank (= `127.0.0.1` in production) | Listen address. Blank in development = all interfaces |
| `FRONTEND_URL` | yes | `https://app.theflyventures.com` | Exact CORS/CSRF origin and the post-OAuth redirect target. **Must be https**, not localhost, no trailing path |
| `MONGODB_URI` | yes | `mongodb://indexrocket:<pw>@127.0.0.1:27017/indexrocket?authSource=indexrocket` | With credentials (§3) |
| `REDIS_URL` | yes | `redis://:<pw>@127.0.0.1:6380` | Dedicated instance (§4) |
| `ENCRYPTION_KEY` | yes | 64 hex chars | **Same value as the worker.** Encrypts Google tokens |
| `GOOGLE_CLIENT_ID` | for Google | from Google Cloud | All three Google values or none; none disables the integration (routes answer 503) |
| `GOOGLE_CLIENT_SECRET` | for Google | from Google Cloud | Secret |
| `GOOGLE_REDIRECT_URI` | for Google | `https://api.theflyventures.com/api/auth/google/callback` | **Must be https**; must exactly match Google Cloud Console |
| `TRUST_PROXY` | no | blank (= `loopback`) | Real client IPs behind the local Nginx |
| `REGISTER_RATE_MAX` | no | blank (= 10/hour/IP) | Account-creation throttle |

### Worker (`/etc/indexrocket/worker.env`) — template: `apps/worker/.env.example`

| Variable | Required | Production value | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | |
| `MONGODB_URI`, `REDIS_URL` | yes | identical to the API | |
| `ENCRYPTION_KEY` | yes | **identical to the API** | Decrypts Google tokens for batches that opt into Google |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | for Google batches | identical to the API | All three or none. The worker only refreshes tokens (ID + secret), but the three are read as one set: if any is blank, batches with Google inspection enabled skip the Google step |
| `INDEXNOW_ENDPOINT` | no | `https://api.indexnow.org/indexnow` | Must be https |
| `WORKER_CONCURRENCY` | no | `5` | Inspection queue |
| `SUBMISSION_CONCURRENCY` | no | `3` | Batch queue |
| `DISCOVERY_CONCURRENCY` | no | `2` | IndexNow queue |
| `DISCOVERY_RATE_MAX`, `DISCOVERY_RATE_DURATION_MS` | no | `10`, `60000` | IndexNow notifications per window |
| `WORKER_HEALTH_HOST`, `WORKER_HEALTH_PORT` | no | `127.0.0.1`, `5100` | `0` disables. Pick another port if 5100 is taken on the VPS |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | no | `60000` | Keep below systemd `TimeoutStopSec` (90 s) |

### Frontend (build time) — template: `apps/web/.env.example`

| Variable | Required | Production value | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | `https://api.theflyventures.com` | **Inlined at build time** (also sets the CSP `connect-src`). Public by design — never a secret |

A production bundle built without `NEXT_PUBLIC_API_URL` refuses to call any API
(it does not fall back to localhost). `next build` prints a warning in that case.

### Startup validation

In `NODE_ENV=production` the API and worker **refuse to start** when:
`FRONTEND_URL` is missing, non-https or localhost; `ENCRYPTION_KEY` is missing or a
repeated-character placeholder; `GOOGLE_REDIRECT_URI` (when Google is configured)
is non-https or localhost; `INDEXNOW_ENDPOINT` is non-https. They **warn** when
Redis has no password or MongoDB has no credentials on a non-local host. Messages
name the variable only, never its value.

Generate the encryption key once and store it in a vault (§12):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. MongoDB setup

IndexRocket uses its own database, `indexrocket`, and its own user.

**If MongoDB is already installed for other applications**, do not change its
`bindIp` or `security.authorization` without checking every existing client:
turning on authorization rejects any client that connects without credentials.
Creating the IndexRocket user is safe either way:

```js
// mongosh (as an admin if authorization is already enabled)
use indexrocket
db.createUser({ user: "indexrocket", pwd: passwordPrompt(), roles: [{ role: "readWrite", db: "indexrocket" }] })
```

Target state (enable authorization when all clients authenticate, or on a fresh
install): `net.bindIp: 127.0.0.1` and `security.authorization: enabled` in
`/etc/mongod.conf`.

- Indexes are declared on the Mongoose models and built automatically.
- Transactions are not required (single-document atomic updates). A replica set
  is still recommended for point-in-time backups.

Index review (each serves a real query):

| Collection | Index | Serves |
|---|---|---|
| users | `email` (unique) | Login, duplicate check |
| projects | `userId, domain` | Owner-scoped list, per-domain duplicate check |
| urls | `projectId, url` (unique) | Per-project uniqueness, idempotent add |
| urls | `projectId, status` | Status filter, summary |
| urls | `projectId, createdAt` | Paginated URL table |
| urls | `projectId, googleInspection.status` | Google filter, summary |
| urls | `projectId, indexNowStatus` | IndexNow filter, summary |
| googleconnections | `userId` (unique) | One connection per user |
| submissionbatches | `projectId, createdAt` / `userId, createdAt` | Batch lists, ownership |
| submissionbatchitems | `batchId, urlId` (unique) | Duplicate-job guard |
| submissionbatchitems | `batchId, status, createdAt` | Item list/filter, counters |
| submissionbatchitems | `urlId, status` | "Already in flight" check |
| submissionbatchitems | `status, updatedAt` | Worker startup recovery sweep |

## 4. Redis setup (dedicated instance)

Redis holds **queues, sessions, OAuth state and throttles** — it is stateful, and
BullMQ requires `maxmemory-policy noeviction`. Eviction policy, persistence and
passwords are **instance-wide**, so IndexRocket runs its **own Redis instance on
`127.0.0.1:6380`** instead of changing any Redis the existing site may use.

The dedicated instance runs as its own systemd unit, `redis-indexrocket.service`,
using `/etc/redis/redis-indexrocket.conf`. Confirm the unit exists and points at
that configuration file first:

```bash
systemctl cat redis-indexrocket.service | head -20
```

`/etc/redis/redis-indexrocket.conf` (owner `redis`, mode 0640):

```conf
port 6380
bind 127.0.0.1
protected-mode yes
daemonize no
supervised systemd
pidfile /run/redis-indexrocket/redis-server.pid
logfile ""
dir /var/lib/redis/indexrocket
requirepass <long-random-password>
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
```

```bash
sudo install -d -o redis -g redis -m 0750 /var/lib/redis/indexrocket
sudo systemctl enable --now redis-indexrocket.service
redis-cli -p 6380 --askpass ping          # PONG
```

- `noeviction` is mandatory: eviction silently deletes queue data.
- Losing Redis entirely logs every user out and drops queued jobs. Batches are
  recoverable: on start the worker re-enqueues unfinished batch items from
  MongoDB (§6).

## 5. Build and API deployment

Release layout: `/opt/indexrocket/releases/<UTC timestamp>` with a `current`
symlink. One build produces the API, worker **and** frontend. Prerequisite: the
`indexrocket` system user (§11) and Node 22 at `/usr/bin/node`.

`REPO_URL` below is your own Git remote for this repository (none is configured
in the repo itself).

```bash
RELEASE=$(date -u +%Y%m%d%H%M%S)
sudo install -d -o "$USER" /opt/indexrocket/releases/$RELEASE
git clone --depth 1 "$REPO_URL" /opt/indexrocket/releases/$RELEASE
cd /opt/indexrocket/releases/$RELEASE

# Do NOT export NODE_ENV=production for these two steps: the build needs devDependencies.
npm ci
NEXT_PUBLIC_API_URL=https://api.theflyventures.com npm run build

# Next.js runtime cache is the only path the services write to.
sudo mkdir -p apps/web/.next/cache
sudo chown -R indexrocket:indexrocket apps/web/.next/cache

sudo ln -sfn /opt/indexrocket/releases/$RELEASE /opt/indexrocket/current
sudo systemctl restart indexrocket-api indexrocket-worker indexrocket-web
curl -fsS http://127.0.0.1:5101/api/ready
curl -fsS http://127.0.0.1:5100/ready
```

`npm run build` at the root runs `tsc -b` for every package and app, and
`next build` for the frontend. Start commands (used by the systemd units):
API `node dist/index.js` in `apps/api` (port 5101), worker `node dist/index.js`
in `apps/worker`, frontend `next start --port 3100 --hostname 127.0.0.1` in
`apps/web`.

Unit: [`deploy/systemd/indexrocket-api.service`](../deploy/systemd/indexrocket-api.service).
On `SIGTERM` the API stops accepting connections, lets in-flight requests finish,
closes its queue producers, Redis and MongoDB, and exits — bounded at 15 s.

## 6. Worker deployment

```bash
sudo systemctl restart indexrocket-worker
curl -fsS http://127.0.0.1:5100/ready
```

Unit: [`deploy/systemd/indexrocket-worker.service`](../deploy/systemd/indexrocket-worker.service).
The worker has no public port and no domain.

- **Graceful shutdown**: on `SIGTERM` the worker stops taking jobs, waits for
  in-flight jobs (up to `WORKER_SHUTDOWN_TIMEOUT_MS`), then closes queues, Redis
  and MongoDB. `TimeoutStopSec` must exceed that timeout.
- **No lost jobs**: a job interrupted by a crash or a forced kill keeps its Redis
  lock only until it expires; BullMQ then returns it to the queue (stalled-job
  recovery). On every start the worker also runs a **batch recovery sweep**:
  unfinished items whose job is missing are re-enqueued, items whose job failed
  for good are marked failed, pending items of cancelled batches are skipped, and
  batch counters are reconciled from the items.
- **Idempotency** holds across all of this: the job id is the item id, the item
  claim is atomic, and the 24-hour IndexNow cooldown prevents a repeated
  notification even if an item runs twice.

## 7. Frontend deployment

Built in §5 with `NEXT_PUBLIC_API_URL=https://api.theflyventures.com`;
`apps/web/.next/cache` is owned by `indexrocket` (the one path the unit leaves
writable). Run with
[`deploy/systemd/indexrocket-web.service`](../deploy/systemd/indexrocket-web.service),
bound to `127.0.0.1:3100`.

Production hardening in `apps/web/next.config.ts`: `X-Powered-By` off, no browser
source maps, and security headers (CSP with `connect-src` limited to the API
origin, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`). The CSP follows this Next.js version's no-nonce guide and
therefore allows `'unsafe-inline'` scripts.

## 8. Nginx

Templates (install names in brackets):

| Repository file | Installs to |
|---|---|
| `deploy/nginx/conf.d/indexrocket-common.conf` | `/etc/nginx/conf.d/indexrocket-common.conf` |
| `deploy/nginx/snippets/indexrocket-proxy.conf` | `/etc/nginx/snippets/indexrocket-proxy.conf` |
| `deploy/nginx/snippets/indexrocket-tls.conf` | `/etc/nginx/snippets/indexrocket-tls.conf` |
| `deploy/nginx/sites/app.theflyventures.com.conf` | `/etc/nginx/sites-available/indexrocket-app` |
| `deploy/nginx/sites/api.theflyventures.com.conf` | `/etc/nginx/sites-available/indexrocket-api` |
| `deploy/nginx/sites/acme-bootstrap.conf` | `/etc/nginx/sites-available/indexrocket-acme-bootstrap` (first issuance only) |

Obtain the certificate first (§9 steps 1–2): the site files reference it and
`nginx -t` fails until it exists.

```bash
sudo cp deploy/nginx/snippets/indexrocket-proxy.conf /etc/nginx/snippets/
sudo cp deploy/nginx/snippets/indexrocket-tls.conf   /etc/nginx/snippets/
sudo cp deploy/nginx/sites/app.theflyventures.com.conf /etc/nginx/sites-available/indexrocket-app
sudo cp deploy/nginx/sites/api.theflyventures.com.conf /etc/nginx/sites-available/indexrocket-api
sudo rm -f /etc/nginx/sites-enabled/indexrocket-acme-bootstrap      # ONLY the IndexRocket bootstrap link
sudo ln -s /etc/nginx/sites-available/indexrocket-app /etc/nginx/sites-enabled/indexrocket-app
sudo ln -s /etc/nginx/sites-available/indexrocket-api /etc/nginx/sites-enabled/indexrocket-api
sudo nginx -t && sudo systemctl reload nginx
```

`reload` (not `restart`) keeps the existing site serving throughout. If
`nginx -t` fails, fix or remove only the IndexRocket files — never edit the
existing site's files to make it pass.

What the templates do: HTTP→HTTPS redirects for the two new hostnames only; HSTS
on the app host without `includeSubDomains` (theflyventures.com is a separate
site); the API's headers come from helmet; 1 MB body limit (matching the API);
edge rate limits (20 r/s general, 10 r/min on login/register);
`/api/ready` restricted to loopback; `X-Forwarded-For` **overwritten** (clients
cannot spoof it); request-id propagation; and an access-log format that omits
query strings so OAuth codes never reach disk. No WebSockets are used.

IPv6 `listen [::]` lines are commented out; enable them only if the existing
sites also listen on `[::]` and you add AAAA records. HTTP/2 follows the existing
`:443` listener; on Nginx ≥ 1.25.1 you may add `http2 on;` inside the IndexRocket
443 server blocks.

**Removing IndexRocket from Nginx** (restores the previous state exactly):

```bash
sudo rm -f /etc/nginx/sites-enabled/indexrocket-app /etc/nginx/sites-enabled/indexrocket-api \
           /etc/nginx/sites-enabled/indexrocket-acme-bootstrap
sudo rm -f /etc/nginx/conf.d/indexrocket-common.conf \
           /etc/nginx/snippets/indexrocket-proxy.conf /etc/nginx/snippets/indexrocket-tls.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 9. HTTPS

IndexRocket gets its **own** certificate, `indexrocket`, covering only
`app.theflyventures.com` and `api.theflyventures.com` (the TLS snippet expects
`/etc/letsencrypt/live/indexrocket/`). The existing theflyventures.com
certificate is not touched. DNS (§A of the checklist) must already resolve to
the VPS.

```bash
# 1. Bootstrap: port 80 answers the ACME challenge for the two new hostnames only
sudo install -d -m 0755 /var/www/indexrocket-acme
sudo cp deploy/nginx/conf.d/indexrocket-common.conf /etc/nginx/conf.d/
sudo cp deploy/nginx/sites/acme-bootstrap.conf /etc/nginx/sites-available/indexrocket-acme-bootstrap
sudo ln -sf /etc/nginx/sites-available/indexrocket-acme-bootstrap /etc/nginx/sites-enabled/indexrocket-acme-bootstrap
sudo nginx -t && sudo systemctl reload nginx

# 2. Issue the certificate; the deploy hook is stored for THIS certificate only
sudo certbot certonly --webroot -w /var/www/indexrocket-acme --cert-name indexrocket \
  -d app.theflyventures.com -d api.theflyventures.com \
  --deploy-hook "systemctl reload nginx"

# 3. Install the real sites (§8), which also removes the bootstrap link

# 4. Renewal
systemctl list-timers | grep certbot          # the existing renewal timer covers it
sudo certbot renew --cert-name indexrocket --dry-run
sudo certbot certificates                      # existing certificate listed unchanged
```

Renewals reuse `/var/www/indexrocket-acme`, which the IndexRocket port-80 server
blocks keep serving. Do not add HSTS `includeSubDomains` or `preload` to
theflyventures.com as part of this work.

## 10. Google OAuth production setup

In Google Cloud Console → *APIs & Services* (same project and OAuth client as
development):

1. **Google Search Console API**: enabled (already, for development).
2. **OAuth client** (type *Web application*):
   - **Authorized redirect URIs** — keep the development entry and add production:
     - `http://localhost:5000/api/auth/google/callback` (development — keep)
     - `https://api.theflyventures.com/api/auth/google/callback` (production — add)
   - **Authorized JavaScript origins**: not required. The flow is fully
     server-side (the API builds the consent URL and handles the callback). If
     Google asks, add `https://app.theflyventures.com`.
3. **OAuth consent screen / Branding**:
   - App name, support email, developer contact.
   - **Authorized domains**: `theflyventures.com` (the registrable domain; it
     covers both subdomains and does not affect the existing website).
   - Homepage `https://app.theflyventures.com`, plus **privacy policy** and
     **terms** URLs on `theflyventures.com` (or `app.theflyventures.com`) —
     required for verification.
   - **Scope**: `https://www.googleapis.com/auth/webmasters.readonly` only.
4. **Publishing status and verification** — plan for this before launch:
   - `webmasters.readonly` is a **sensitive** scope. While the app is in
     *Testing*, only listed test users can connect (max 100) and **refresh tokens
     expire after 7 days**, so connections silently stop working weekly.
   - Moving to *In production* requires Google's **app verification** (ownership of
     `theflyventures.com` in Search Console, privacy policy, scope justification,
     possibly a demo video). Until verified, users see the "unverified app"
     warning and a user cap applies.
5. Store `GOOGLE_CLIENT_SECRET` only in `/etc/indexrocket/api.env` and
   `/etc/indexrocket/worker.env`.

The redirect URI must match `GOOGLE_REDIRECT_URI` **exactly** (scheme, host,
path, no trailing slash). The application code is unchanged: it takes the
redirect URI and the post-connect destination from configuration.

Flow in production: `https://app.theflyventures.com` → `https://api.theflyventures.com/api/auth/google/start`
(authenticated) → Google consent → `https://api.theflyventures.com/api/auth/google/callback`
(single-use state checked) → redirect to `https://app.theflyventures.com/google`.

## 11. Process manager

systemd units are provided in [`deploy/systemd/`](../deploy/systemd):

```bash
sudo useradd --system --home /opt/indexrocket --shell /usr/sbin/nologin indexrocket   # before §5
sudo cp deploy/systemd/indexrocket-api.service deploy/systemd/indexrocket-worker.service \
        deploy/systemd/indexrocket-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now indexrocket-api indexrocket-worker indexrocket-web
systemctl status indexrocket-api indexrocket-worker indexrocket-web --no-pager
```

They run as an unprivileged user, restart on failure, send `SIGTERM` for graceful
shutdown, and apply systemd sandboxing (`ProtectSystem=strict`, `NoNewPrivileges`,
…). All unit names are prefixed `indexrocket-`, so nothing existing is replaced.

## 12. Backups

| What | How | Frequency |
|---|---|---|
| MongoDB `indexrocket` db | `mongodump --uri="$MONGODB_URI" --gzip --archive=indexrocket-$(date -u +%F).gz` to an off-host, encrypted location | Daily; keep 14–30 days |
| `ENCRYPTION_KEY` | In a password manager / secrets vault, **separately** from DB dumps | Once, and on rotation |
| `/etc/indexrocket/*.env`, IndexRocket Nginx and systemd files, `/etc/redis/redis-indexrocket.conf` | Encrypted config backup | On change |
| Redis (6380) | AOF/RDB snapshot | Optional — sessions and queues are rebuildable |

Without `ENCRYPTION_KEY` the stored Google tokens cannot be decrypted; users would
have to reconnect Search Console. **Test a restore** into a scratch database at
least quarterly.

## 13. Logs

- Application logs go to journald: `journalctl -u indexrocket-api -f` (and
  `-worker`, `-web`). Cap retention with `SystemMaxUse=` in `journald.conf`.
- Nginx access logs: `/var/log/nginx/indexrocket-app.access.log` and
  `/var/log/nginx/indexrocket-api.access.log` (`ir_safe` format, no query strings).
- The API logs method, **redacted** path, status, duration, user agent and a
  **request id** (also returned as `X-Request-Id` and included in every error
  body).
- **Never logged**: passwords, password hashes, OAuth codes or state, access or
  refresh tokens, IndexNow keys, the encryption key, cookies, session ids,
  `Authorization` headers, request bodies.

## 14. Health checks

| Endpoint | Exposure | Meaning |
|---|---|---|
| `GET https://api.theflyventures.com/api/health` | Public | Process up; Mongo/Redis connection state |
| `GET http://127.0.0.1:5101/api/ready` | Loopback only (Nginx denies it publicly) | Real round trip to MongoDB **and** Redis; 503 if either fails |
| `GET http://127.0.0.1:5100/health` | Loopback | Worker process alive |
| `GET http://127.0.0.1:5100/ready` | Loopback | Worker's Mongo + Redis ping succeed and queue workers are running |

Responses report ok/fail only and are sent with `Cache-Control: no-store`.

## 15. Rollback procedure

1. Point `current` back at the previous release and restart:
   ```bash
   sudo ln -sfn /opt/indexrocket/releases/$PREVIOUS /opt/indexrocket/current
   sudo systemctl restart indexrocket-api indexrocket-worker indexrocket-web
   curl -fsS http://127.0.0.1:5101/api/ready && curl -fsS http://127.0.0.1:5100/ready
   ```
2. Data changes through Step 13 are **additive** (new fields and indexes only).
3. The one-time project ownership migration has its own guarded rollback:
   `node scripts/migrate-project-ownership.mjs --rollback --apply`.
4. To take IndexRocket off the server entirely: stop and disable the three
   `indexrocket-*` units, then remove its Nginx files (§8). theflyventures.com is
   unaffected either way.

Keep at least the two previous releases on disk.

## 16. Security checklist

Before go-live:

- [ ] theflyventures.com checks (§0 pre-flight) repeated after deployment and identical
- [ ] `NODE_ENV=production` for API and worker; both start without config errors
- [ ] `FRONTEND_URL=https://app.theflyventures.com`; `GOOGLE_REDIRECT_URI=https://api.theflyventures.com/api/auth/google/callback`; `ENCRYPTION_KEY` random and identical in API and worker
- [ ] `/etc/indexrocket/*.env` are mode 0600, owned by root:root; no `.env` files in releases
- [ ] `ss -tlnp` shows 3100, 5100, 5101, 6380 (and 27017) on 127.0.0.1 only
- [ ] MongoDB: `indexrocket` user with `readWrite` on `indexrocket` only; bound to loopback
- [ ] Redis 6380: `requirepass` set, bound to loopback, `appendonly yes`, `maxmemory-policy noeviction`
- [ ] Firewall unchanged: 80/443 open (already), 3100/5100/5101/6380 not open
- [ ] Nginx: valid `indexrocket` certificate, `/api/ready` not public, rate limits active
- [ ] Frontend built with `NEXT_PUBLIC_API_URL=https://api.theflyventures.com`
- [ ] Google OAuth: production redirect URI registered; consent screen complete; verification plan in place
- [ ] Session cookie observed as `HttpOnly; Secure; SameSite=Lax`, host `api.theflyventures.com`, no `Domain`
- [ ] No development accounts or credentials in the production database
- [ ] Backups scheduled and one restore tested; `ENCRYPTION_KEY` stored in the vault
- [ ] `npm audit` reviewed for the release

Already enforced in code (verified by the test suites): authentication on every
non-public route; ownership checks on every project, URL, batch and Google
operation; exact-origin CORS/CSRF (the sibling theflyventures.com origin is
rejected); JSON-only bodies; SSRF protection with DNS pinning; IndexNow host and
key verification and 24-hour cooldown; OAuth single-use state; Google host
allowlist; encrypted OAuth tokens; scrypt password hashing; login and
registration throttles; no stack traces in production responses; redacted logs.

## 17. Production smoke tests

Run on the VPS after §5–§11. All commands are read-only.

```bash
# Local health (loopback only)
curl -fsS http://127.0.0.1:5101/api/ready     # {"ready":true,"checks":{"database":"ok","redis":"ok"}}
curl -fsS http://127.0.0.1:5100/ready         # worker: database, redis, workers running
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/login   # 200

# Public endpoints
curl -fsS https://api.theflyventures.com/api/health                                   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://api.theflyventures.com/api/ready     # 403 (not public)
curl -sI http://app.theflyventures.com | grep -i '^location'    # https://app.theflyventures.com/
curl -sI http://api.theflyventures.com | grep -i '^location'    # https://api.theflyventures.com/
curl -sI https://app.theflyventures.com | grep -iE 'strict-transport|content-security|x-frame'
curl -sI https://api.theflyventures.com/api/health | grep -iE 'strict-transport|x-request-id|x-powered-by'   # no x-powered-by

# CORS / origin: only the frontend is allowed
curl -sI -H 'Origin: https://app.theflyventures.com' https://api.theflyventures.com/api/health \
  | grep -i 'access-control-allow-origin'                        # https://app.theflyventures.com
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://theflyventures.com' \
  -H 'Content-Type: application/json' -d '{}' https://api.theflyventures.com/api/auth/login   # 403

# Nothing internal is exposed
sudo ss -tlnp | grep -E ':(3100|5100|5101|6380)\b'               # all 127.0.0.1

# The existing site is unchanged (compare with the §0 snapshot)
curl -sI https://theflyventures.com      > ~/theflyventures-after.txt
curl -sI https://www.theflyventures.com >> ~/theflyventures-after.txt
echo | openssl s_client -connect theflyventures.com:443 -servername theflyventures.com 2>/dev/null \
  | openssl x509 -noout -subject -enddate -fingerprint -sha256 >> ~/theflyventures-after.txt
diff <(grep -viE '^(date|expires|last-modified|etag|age|cf-ray|x-request-id|set-cookie):' ~/theflyventures-before.txt) \
     <(grep -viE '^(date|expires|last-modified|etag|age|cf-ray|x-request-id|set-cookie):' ~/theflyventures-after.txt) \
  && echo "theflyventures.com unchanged"
```

Browser checks at `https://app.theflyventures.com`:

1. Register and log in. In devtools the `ir_session` cookie shows `HttpOnly`,
   `Secure`, `SameSite=Lax`, host `api.theflyventures.com`, and no `Domain`.
2. Create a project and add a URL.
3. Connect Google Search Console: consent at Google, then return to
   `https://app.theflyventures.com/google` showing the connection.
4. Run a small batch and watch it complete.
5. `journalctl -u indexrocket-api -u indexrocket-worker --since -15min` shows no
   errors and no tokens, cookies or OAuth codes.
