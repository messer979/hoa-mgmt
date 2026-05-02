# HOA Board

Next.js + Supabase app to run HOA board discussions and votes. Members can
**Affirm / Reject / Abstain** on topics. Admins can:

- create topics,
- watch a dedicated **Inbox** of inbound emails (board members who reply by
  email instead of the web), and
- record a **proxy vote** on a member's behalf, citing the email as the source.

Inbound + outbound email is handled by **Resend** (one-click integration on
Vercel's marketplace). All inbound mail flows through a Svix-signed webhook
into a Supabase Postgres table that powers the Inbox UI.

## Stack

- Next.js 15 (App Router, RSC, server actions)
- Supabase (Postgres + Auth + RLS)
- Resend (`@resend/node` for outbound, Resend Inbound for inbound, Svix-signed)
- Tailwind CSS

## Setup

### 1. Supabase

1. Create a project at https://supabase.com.
2. SQL editor → paste `supabase/migrations/0001_initial.sql` → Run.
3. Auth → URL configuration: add `https://<your-vercel-domain>/auth/callback`
   (and `http://localhost:3000/auth/callback`) as redirect URLs.
4. Promote yourself to admin once you've signed in once:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

### 2. Resend (via Vercel Marketplace — recommended)

1. In your Vercel project: **Integrations → Browse Marketplace → Resend → Add**.
   This auto-injects `RESEND_API_KEY` as an env var.
2. In Resend: **Domains** → add your sending domain (e.g. `yourhoa.example`)
   and complete DNS.
3. **Inbound** → Create inbound address (e.g. `board@inbound.yourhoa.example`).
   Set the destination to a webhook pointing at:
   ```
   https://<your-vercel-domain>/api/webhooks/inbound-email
   ```
4. Copy the webhook **signing secret** — this is `RESEND_WEBHOOK_SECRET`.
5. (Optional) tell members to reply to the inbound address; set
   `RESEND_INBOUND_ADDRESS` so outbound announcements use it as `Reply-To`.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Var | What |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API |
| `SUPABASE_SERVICE_ROLE_KEY` | Used only by the inbound webhook |
| `RESEND_API_KEY` | Auto-set by the Vercel integration |
| `RESEND_FROM_EMAIL` | e.g. `board@yourhoa.example` |
| `RESEND_INBOUND_ADDRESS` | e.g. `board@inbound.yourhoa.example` |
| `RESEND_WEBHOOK_SECRET` | From the Resend webhook page (Svix `whsec_…`) |
| `NEXT_PUBLIC_SITE_URL` | e.g. `https://board.yourhoa.example` |

### 4. Run

```bash
npm install
npm run dev
```

Deploy: push to GitHub and import the repo into Vercel. Add the env vars above.

## Data model

- `profiles` — one per `auth.users`; `role` is `member` or `admin`.
- `topics` — title, description, status (`open`/`closed`/`passed`/`failed`),
  optional `closes_at`.
- `votes` — `(topic_id, voter_id)` unique, `choice ∈ {affirm,reject,abstain}`,
  `source ∈ {web,email,admin_proxy}`, `voted_by` (the admin who recorded a
  proxy vote), `email_id` (provenance).
- `emails` — inbound message archive: from/to, subject, plain + HTML body,
  raw payload, `matched_profile_id`, `topic_id`, `processed`.

## Inbox flow

1. Member replies to the announcement email.
2. Resend Inbound POSTs the parsed message to
   `/api/webhooks/inbound-email`. The route verifies the Svix signature and
   inserts into `public.emails`.
3. The webhook auto-matches:
   - sender → `profiles.email` (case-insensitive),
   - subject (stripped of `Re:` / `Fwd:`) → `topics.title`.
4. An admin opens **Inbox**, picks the email, confirms the auto-guessed
   choice (`yes` / `no` / `abstain` parsed from the body), and clicks
   **Record proxy vote**. That:
   - upserts a `votes` row for the matched member with `source = 'email'`,
     `email_id` set, `voted_by` = admin,
   - marks the email `processed = true`.

RLS ensures only admins can read the `emails` table or insert votes on behalf
of others.
