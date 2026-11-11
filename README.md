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

`AT_API_KEY` and `AT_USERNAME` are required. `AT_SENDER_ID` is optional. When the username is `sandbox`, messages go to `https://api.sandbox.africastalking.com/version1/messaging` and the sender id is not sent. Any other username uses `https://api.africastalking.com/version1/messaging`, and `from` is included only when `AT_SENDER_ID` is set.

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

The Worker also runs a cron trigger every minute (`* * * * *`). It expires offers and offers the job to the next technician. Cloudflare starts that schedule on deploy. It does not need its own database or bucket, but the deploy still fails if D1 or the uploads bucket is missing.

## Phase 3 test checklist

- [ ] `npm test` includes the distance and offer-order checks.
- [ ] A technician can save trades, a base location, a radius, and switch on duty. The profile stays unapproved until an admin approves it, so it receives no offers yet.
- [ ] With an approved, on-duty technician inside the radius, creating a job offers it to the nearest one and sets the job to `offered`. The text is logged when `OTP_DEV_MODE=true`.
- [ ] The technician can accept or decline. Accepting assigns the job. Declining, or waiting out the 10-minute window, offers it to the next person.
- [ ] An emergency job is offered to the top three at once. The first acceptance assigns it and closes the other offers.
- [ ] After three offers with no acceptance, or when nobody is in range, the job is flagged. The operator dashboard lists that status and does not assign by hand.
- [ ] The assigned technician can mark on the way, on site, and completed, with a note, materials, minutes, and an optional photo.
- [ ] A technician cannot open another person's job. The public homepage is unchanged.
- [ ] A technician, operator, or admin can upload a JPG, PNG, or WebP profile photo. It is stored under `technician-photos/` and served only through the Worker.
- [ ] After a job is assigned, that client sees the technician's photo, first name, and trade. Another client does not. Cancelling or reassigning the job hides it. With no photo, the page shows initials, not a picture of a person.

The onboarding selfie and certificate files from `/join` stay private. This profile photo is the picture the client sees once someone is assigned. They are different files.

Local dispatch checks use `node scripts/seed-dispatch-local.mjs`. It refuses `--remote` and only creates the obvious test numbers `+254700000301`, `+254700000302`, `+254700000303`, and `+254700000304`.

## Technician onboarding

Apply migration `0005_technician_applications.sql` with the same local and remote D1 commands as the earlier migrations. It adds `technician_applications`, `technician_documents`, and `invites`. `applicant_status` is `technician_applications.status`. The phone login endpoints are unchanged. A verified phone on `/join` creates the draft application. The role stays `client` until an admin or operator approves it.

The daily licence check uses the existing every-minute cron. It does not add a second schedule. Inside the scheduled handler it runs at most once per Africa/Nairobi day and stores that date in `settings.licence_check_on`. No new secret is required. Uploads still use the existing `nurumaji-uploads` bucket.

`/join` is a static page. Its script and stylesheet are versioned (`?v=20261106e`) and use the one-day cache rule. The page allows geolocation for this path only (`geolocation=(self)`), so “Use my location” can fill the base coordinates. `/join` itself has no map.

## Operator map and test sheets

Apply these two migrations before the operator map or job test sheets are used. Both are additive.

- `migrations/0006_technician_location.sql` adds `live_lat`, `live_lng`, and `live_updated_at` on `technician_profiles`.
- `migrations/0007_job_test_sheets.sql` adds `job_test_sheets`.

The operator board shows open jobs and on-duty technicians who are sharing a location. The map uses Leaflet from `/assets/leaflet/` and OpenStreetMap tiles. A shared position older than 30 minutes is hidden. Clients cannot see technician positions. A fresh shared position is also used when ranking dispatch distance, and the saved base is used when the shared position is missing or stale.

A technician fills a test sheet before marking electrical or plumbing work completed. The sheet is a record of what they entered. It does not apply a pass mark.

Probation length is the admin setting `probation_completed_jobs` on the Applications page. Leave it blank until Deng sets it. While it is blank, a technician on probation only receives standard-urgency jobs and does not leave probation automatically.

Uploaded ID images, the onboarding selfie, and certificates are stored under `applications/` and are served only to the applicant or an admin/operator through `/api/join/documents/:id`. They are not public, not written to logs, and not shown on client job pages.

## Onboarding test checklist

- [ ] The menu contains “Join as a technician” and the footer contains the exact link text “Careers / Work with us”. Both open `/join`.
- [ ] `/join` does not state a pay rate, a job volume, or that Nurumaji itself is licensed. The pay line is marked as a placeholder.
- [ ] Apply now asks for the same phone code as login. A new number is still created as `client`, and the application status becomes `draft`. Leaving and returning keeps the saved steps.
- [ ] An invite link (`/join?invite=…`) skips the introduction, works once, and is rejected after use or after 7 days. The Applications list tags that person as invited. The plaintext link is shown once and is not stored or logged.
- [ ] Personal details, trade, licences, coverage, M-Pesa, two references, and the terms checkbox save. Terms store a timestamp.
- [ ] Uploads accept only JPEG, PNG, WebP, or PDF, and reject a file over 10 MB. A sixth application submit or a 31st upload from the same user in a day returns 429.
- [ ] Opening a document URL while signed out, or as another client, returns 401 or 404. The file is not on a public asset path.
- [ ] Submitting sets the status to `submitted`. The queue filters by status, trade, and area. The list shows only the last two characters of the ID and KRA PIN. The detail page shows the full values and the files.
- [ ] Request information sends an SMS, sets `needs_info`, and reopens only the selected steps. Reject requires a reason and sends an SMS. Approve sets the role to `technician`, creates the profile with `approved = 1` and `on_duty = 0`, and sends the login link. Each action is in `audit_log` without the ID number, KRA PIN, date of birth, or file contents.
- [ ] Approve on probation leaves the technician eligible for standard jobs only. After the admin sets N, urgent and emergency jobs stay withheld until that many jobs are completed, invoiced, or paid.
- [ ] The shared minute cron sends one SMS at 30 days and one at 7 days before a licence expiry. On the expiry date it sets `approved = 0`, sends one SMS, and the technician dashboard shows the renewal banner. Re-approve after the renewal is checked turns offers back on.

## Phase 4: operator board, quotes and invoices

No new migration. `quotes` and `invoices` are already created by `0001_init.sql`. Quote status stays `draft`, `sent`, `approved`, or `rejected`. Invoice status stays `unpaid`, `paid`, or `void`. There is no new secret, cron, or bucket. Quote and invoice amounts are typed by the operator. This phase does not set a price, and it does not take M-Pesa payments. Marking an invoice paid only records that the operator has received the money.

An admin can open the operator board. Creating a phone-in job uses the existing dispatch. Assigning or reassigning writes `audit_log`.

## Phase 4 test checklist

- [ ] The operator board filters by status, trade, urgency, and area, and lists the nearest on-duty suggestions.
- [ ] An operator can create a job for a client who phones in. A new number is stored as `client`. The job is offered by the existing dispatch.
- [ ] An operator can assign or reassign an approved technician. The open offers close, the technician gets a text, and the audit log records the change.
- [ ] Sending a quote requires an amount in whole shillings. The client can approve a `sent` quote, and the timeline records it.
- [ ] After the work is completed, an operator can create an invoice for an amount they type. Marking it paid sets the job to `paid`. The client page does not claim the site collected the money.

## Phase 5: admin tools

No new migration, secret, cron, or bucket. Offer timeout, service areas, and a pricing note are rows in the existing `settings` table. The offer timeout already defaults to 600 seconds. Service areas and the pricing note start empty. The pricing note is shown to operators and is not copied into a quote. Quotes still need an amount typed on the job.

Reports are counted from jobs, paid invoices, ratings, and the time of the first assignment. Role changes are written to `audit_log`. Job assignment was already written there. The admin list of technicians shows only the last two digits of an ID. The full ID and the certificate files stay on the application page.

## Phase 5 test checklist

- [ ] An admin can change a user's role. The last admin cannot be removed. The change appears in the audit list without the person's ID number.
- [ ] The technician list links to the application for the full ID and certificates, and the list itself masks the ID.
- [ ] Saving settings changes the offer timeout, and leaves service areas and the pricing note blank until someone types them. A saved pricing note does not fill in a quote amount.
- [ ] Reports show jobs per Nairobi day, the sum of paid invoices, completed jobs per technician, and the average time to the first assignment. Empty data stays empty.

## Not in this phase

The installable app, M-Pesa payments, and the later A–G add-ons. Do not start those from this branch.
