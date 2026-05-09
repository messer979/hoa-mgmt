# HOA Board

Next.js + Supabase app to run HOA board discussions and votes. Members can
**Affirm / Reject / Abstain** on topics. Admins create topics, manage the
roster, and run a dedicated **Inbox** of inbound emails so they can record a
**proxy vote** on a member's behalf with full provenance.

Inbound + outbound email is handled by **Resend** (one-click integration on
Vercel's marketplace). Inbound mail flows through a Svix-signed webhook into a
Supabase Postgres table that powers the Inbox UI.

## Auth model

There is no per-user account. Auth is a single shared **`APP_PASSWORD`** in
`.env`. Sign-in is two steps:

1. **Enter password** (`/login`) → sets a signed `hoa_auth` cookie.
2. **Pick yourself** from the roster (`/whoami`) → sets `hoa_user` cookie.

That selection is your identity throughout the app; admin status comes from
the `profiles.role` column. Rotating `APP_PASSWORD` invalidates every session.

The app talks to Supabase using the **service-role key** server-side only. RLS
is enabled with no policies (anon = denied), so the anon key is unused.

## Stack

- Next.js 15 (App Router, RSC, server actions)
- Supabase Postgres (no Supabase Auth)
- Resend (`resend` SDK for outbound, Resend Inbound for inbound, Svix-signed)
- Tailwind CSS

## Setup

### 1. Supabase

1. Create a project at https://supabase.com.
2. SQL editor → paste `supabase/migrations/0001_initial.sql` → Run.
3. Copy the **service-role key** (Settings → API) into `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Resend (via Vercel Marketplace — recommended)

1. Vercel project → **Integrations → Browse Marketplace → Resend → Add**.
   Auto-injects `RESEND_API_KEY`.
2. Resend → **Domains** → add a sending domain and complete DNS.
3. **Inbound** → create an inbound address (e.g.
   `board@inbound.yourhoa.example`) with destination webhook
   `https://<your-vercel-domain>/api/webhooks/inbound-email`.
4. Copy the webhook signing secret into `RESEND_WEBHOOK_SECRET`.
5. Set `RESEND_INBOUND_ADDRESS` so outbound announcements use it as Reply-To.

### 3. Environment variables

Copy `.env.example` to `.env.local`:

| Var | What |
|---|---|
| `APP_PASSWORD` | Shared password for the board. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Used by every server query and the webhook. |
| `RESEND_API_KEY` | Auto-set by the Vercel integration. |
| `RESEND_FROM_EMAIL` | e.g. `board@yourhoa.example`. |
| `RESEND_INBOUND_ADDRESS` | e.g. `board@inbound.yourhoa.example`. |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret from the Resend webhook. |
| `NEXT_PUBLIC_SITE_URL` | e.g. `https://board.yourhoa.example`. |

### 4. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, enter `APP_PASSWORD`, then add yourself as the
first admin. Subsequent members are added from `/members`.

Deploy by pushing to GitHub and importing the repo into Vercel; set the env
vars above.

## Data model

- `profiles` — board roster, `role: member|admin`. Admins manage from `/members`.
- `topics` — `title`, `description`, `status (open|closed|passed|failed)`,
  optional `closes_at`.
- `votes` — `(topic_id, voter_id)` unique, `choice`,
  `source ∈ {web,email,admin_proxy}`, `voted_by` (admin who recorded a proxy),
  `email_id` (provenance back to the inbound email).
- `emails` — full inbound archive: from/to, subject, plain + HTML body, raw
  Svix payload, `matched_profile_id`, `topic_id`, `processed`.

## Inbox flow

1. Member replies to an announcement.
2. Resend Inbound POSTs the parsed email to
   `/api/webhooks/inbound-email`. The route Svix-verifies and stores it.
3. The webhook auto-matches:
   - sender → `profiles.email` (case-insensitive),
   - subject (stripped of `Re:` / `Fwd:`) → `topics.title`.
4. An admin opens **Inbox**, picks the email, confirms the auto-guessed
   choice (parsed from the body for `yes` / `no` / `abstain`-ish words), and
   clicks **Record proxy vote**:
   - upserts a `votes` row for the matched member with `source='email'`,
     `email_id` set, `voted_by` = the admin,
   - marks the email `processed = true`.
