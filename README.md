# Nurumaji

Public website and the client portal, served by one Cloudflare Worker. Phase 2 adds booking.

## Portal setup

Do this before merging to `main`. Both of these must exist in the Cloudflare account or the automatic production deploy fails:

- D1 database `nurumaji-db`, with its real id pasted over the placeholder in `wrangler.jsonc`
- R2 bucket `nurumaji-uploads` (the Worker binds it as `UPLOADS`)

A failed deploy does not replace the Worker that is already live, so the public site stays on the last successful deployment. Nothing in this branch goes out until a deploy succeeds.

### 1. Install

```bash
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create nurumaji-db
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.

### 3. Apply migrations

```bash
npx wrangler d1 migrations apply nurumaji-db --local
npx wrangler d1 migrations apply nurumaji-db --remote
```

### 4. Create the uploads bucket

Phase 2 binds this bucket. Create it before merging or deploying:

```bash
npx wrangler r2 bucket create nurumaji-uploads
```

### 5. Set secrets

Production text messages use Africa's Talking. Do not set `OTP_DEV_MODE` on production.

```bash
npx wrangler secret put AT_API_KEY
npx wrangler secret put AT_USERNAME
npx wrangler secret put AT_SENDER_ID
```

For local sign-in without sending a text, copy the example and leave dev mode on:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` is gitignored. With `OTP_DEV_MODE=true`, the 6-digit code is printed in the `wrangler dev` log as `[OTP_DEV_MODE]`.

`APP_URL` is set in `wrangler.jsonc` to `https://nurumaji.regiscompliance.workers.dev`. Change that value when the custom domain is attached. Pages and the API use relative links, so sign-in still works if you have not changed it. Local `.dev.vars` can set `APP_URL=http://127.0.0.1:8787`.

### 6. Deploy

Only after the real `database_id` is in `wrangler.jsonc`, the R2 bucket exists, and the remote migration has been applied:

```bash
npx wrangler deploy
```

Cloudflare Workers Builds must run `npm install` before `wrangler deploy`, because the Worker bundles Hono and Zod.

### 7. Create the first admin

Use your own Kenyan mobile number. This promotes that number to `admin` (or creates it). It does not print a login code.

```bash
ADMIN_PHONE=+2547XXXXXXXX npm run seed:admin -- --remote
```

Local equivalent, after the local migration:

```bash
ADMIN_PHONE=+2547XXXXXXXX npm run seed:admin
```

Then open `/portal/login`, request a code, and sign in. A number that has never been seeded becomes a client.

## Local development

```bash
npm test
npx wrangler d1 migrations apply nurumaji-db --local
npx wrangler dev
```

The public pages stay static. `/`, unknown URLs (the 404 page), and `/assets/*` are not handled by the portal Worker. `/portal/*` and `/api/*` are.

## Phase 1 test checklist

- [ ] `npm test` passes the phone-number checks.
- [ ] `/` still shows the public homepage, and an unknown path still shows the site 404 page.
- [ ] `/assets/styles.css` still returns the one-day `Cache-Control` from `site/_headers`, not the 30-day asset rule joined onto it.
- [ ] `POST /api/auth/otp/request` with `0712345678` returns the normalised `+254712345678` number.
- [ ] A fourth code request for the same number inside 15 minutes returns 429.
- [ ] A wrong code increments attempts. The sixth try, or a code older than 5 minutes, is rejected.
- [ ] The correct code sets an `nm_session` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) and opens the client dashboard.
- [ ] A brand-new number is stored as `client`. The seeded `ADMIN_PHONE` opens the admin dashboard.
- [ ] Change a user's `role` to `technician`, `operator`, or `admin` and confirm each empty dashboard. A client who opens `/portal/admin` gets “not available”.
- [ ] Sign out clears the cookie and returns to `/portal/login`.
- [ ] With `OTP_DEV_MODE` unset and the Africa's Talking secrets missing, a code request returns 503 and does not reveal a code.

## Phase 2 test checklist

- [ ] The header shows Client Login, and it opens `/portal/login`. The footer has Track my job.
- [ ] A logged-out “Request a proposal”, “For homes” job, or urgent-help link opens `/book` with the service or urgency filled in. The contact page still sends email.
- [ ] On `/book`, the code step creates the user, saves the name, creates the job, and lands on the client dashboard. The timeline says the request was received.
- [ ] A signed-in visit to `/portal/book` shows the full form: trade, description, urgency, address, Use my location, preferred time, and optional photos.
- [ ] A job with a photo stores the file in R2 and the client can open it. Another client cannot.
- [ ] More than 8 jobs in an hour for one user, or 20 from one connection, returns 429.
- [ ] Quote approval and rating controls are visible. Approving a `sent` quote and rating a `completed` job write a timeline event. They do nothing until that data exists.
- [ ] Homepage Lighthouse on mobile stays in the high 90s or at 100, and the JSON-LD hashes in `site/_headers` still match.

## Not in this phase

Dispatch, the operator board, admin tools, the installable app, and payments.
