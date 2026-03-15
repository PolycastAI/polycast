# Polycast: Deploy to Vercel + Supabase

Follow these steps in order.

---

## Part 1: Run database migrations (Supabase)

### Step 1.1 — Open the SQL Editor

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) and open your project (the one whose URL and service role key you have in `.env.local`).
2. In the left sidebar, click **SQL Editor**.

### Step 1.2 — Run the schema

1. Click **New query**.
2. Open the file **`lib/db/schema.sql`** in this repo and copy its **entire** contents.
3. Paste into the Supabase SQL Editor.
4. Click **Run** (or press Cmd/Ctrl + Enter).
5. You should see “Success. No rows returned.” The script uses `CREATE TABLE IF NOT EXISTS`, so it’s safe to run again if you need to.

### Step 1.3 — Confirm tables

1. In the left sidebar, open **Table Editor**.
2. You should see all 12 tables:  
   `markets`, `predictions`, `model_performance`, `model_pnl_history`, `prompt_versions`, `market_prices`, `rejected_markets`, `held_markets`, `error_log`, `re_run_schedule`, `sensitivity_tests`, `daily_backup`.

Database setup is done. Keep the Supabase project open; you’ll need **Project URL** and **service_role key** for Vercel.

---

## Part 2: Deploy to Vercel

### Step 2.1 — Push code to GitHub

1. In Terminal, from the project root (e.g. `~/Desktop/polycast`):

   ```bash
   git init
   git add .
   git commit -m "Initial Polycast app"
   ```

2. Create a new repo on GitHub (e.g. `your-username/polycast`), then:

   ```bash
   git remote add origin https://github.com/your-username/polycast.git
   git branch -M main
   git push -u origin main
   ```

   (Use your real repo URL and branch name if different.)

### Step 2.2 — Import project in Vercel

1. Go to [Vercel](https://vercel.com) and sign in.
2. Click **Add New…** → **Project**.
3. Import the **polycast** GitHub repo.
4. Leave **Framework Preset** as Next.js and **Root Directory** empty.
5. Do **not** deploy yet — add environment variables first.

### Step 2.3 — Add environment variables

1. In the Vercel project setup, open **Environment Variables**.
2. Add each variable below. Use **Production**, and add to **Preview** too if you use preview deployments.

   | Name | Value | Notes |
   |------|--------|--------|
   | `SUPABASE_URL` | Your Supabase project URL | From Supabase → Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase `service_role` key | Same place; **keep secret** |
   | `ANTHROPIC_API_KEY` | Your Anthropic API key | From `.env.local` |
   | `OPENAI_API_KEY` | Your OpenAI API key | From `.env.local` |
   | `GOOGLE_AI_API_KEY` | Your Google AI (Gemini) key | From `.env.local` |
   | `XAI_API_KEY` | Your xAI (Grok) key | From `.env.local` |
   | `BLUESKY_HANDLE` | `@polycastai.bsky.social` | Or your Bluesky handle |
   | `BLUESKY_APP_PASSWORD` | Your Bluesky app password | From `.env.local` |
   | `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | From `.env.local` |
   | `TELEGRAM_CHAT_ID` | Your Telegram chat ID | From `.env.local` |
   | `CRON_SECRET` | A long random string | Generate once; see below |
   | `NEXT_PUBLIC_BASE_URL` | Your Vercel URL | e.g. `https://polycast.vercel.app` |

3. **CRON_SECRET**: Generate a random string (e.g. `openssl rand -hex 32`) and paste it as `CRON_SECRET`. Vercel Cron will send this in the `Authorization: Bearer <CRON_SECRET>` header when hitting your cron routes. Do not share it.

4. **NEXT_PUBLIC_BASE_URL**: Set this to your production URL so the admin page can call your API (e.g. `https://polycast.vercel.app`). After the first deploy, if you use a custom domain, update this to that domain.

### Step 2.4 — Deploy

1. Click **Deploy**.
2. Wait for the build to finish. If it fails, check the build log (often a missing env var or TypeScript error).
3. When it’s done, open your deployment URL (e.g. `https://polycast-xxx.vercel.app`).

### Step 2.5 — Turn on Cron Jobs (Pro or higher)

- Cron jobs in `vercel.json` run only on **Vercel Pro** (or higher) plans.
- If you’re on **Hobby**: the app and API routes work, but scheduled crons will not run unless you use an external scheduler (e.g. cron-job.org) to hit your cron URLs with the correct `Authorization: Bearer <CRON_SECRET>` header at the right times.

If you have Pro:

1. In the Vercel project, go to **Settings** → **Crons**.
2. You should see the 6 jobs from `vercel.json` (pipeline, run-approved, resolution, price-updater, re-run, weekly-leaderboard). No extra setup needed; Vercel will call them on the defined schedules and send `CRON_SECRET`.

### Step 2.6 — (Optional) Custom domain

1. **Settings** → **Domains** → add `polycast.ai` (or your domain).
2. Follow Vercel’s DNS instructions.
3. Update `NEXT_PUBLIC_BASE_URL` to `https://polycast.ai` and redeploy if needed.

---

## Part 3: Quick checks after deploy

1. **Homepage**  
   Visit `https://your-app.vercel.app`. You should see the Polycast homepage (leaderboard may be empty at first).

2. **Admin**  
   Visit `https://your-app.vercel.app/admin`. You should see the approval dashboard (pending list may be empty until the pipeline runs).

3. **Cron (if on Pro)**  
   After 9:00 UTC, check Telegram for the shortlist notification. Then approve some markets in `/admin` and click **Run approved markets**, or wait for the 11:00 UTC cron.

4. **Cron auth (manual test)**  
   If you call a cron URL without the secret, it should return 401:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://your-app.vercel.app/api/cron/pipeline
   # Expect 401 if CRON_SECRET is set
   ```

---

## Summary

| Step | What you did |
|------|------------------|
| 1    | Ran `lib/db/schema.sql` in Supabase SQL Editor |
| 2    | Pushed repo to GitHub |
| 3    | Imported repo in Vercel, added env vars, deployed |
| 4    | Set `CRON_SECRET` and `NEXT_PUBLIC_BASE_URL` |
| 5    | (Pro) Crons run automatically; (Hobby) use external scheduler if needed |

If anything fails (build, cron, or admin), check Vercel **Functions** and **Logs** and Supabase **Logs** for errors.
