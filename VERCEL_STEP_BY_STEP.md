# Deploy Polycast to Vercel — Slow Step-by-Step Guide

You’ve already done the Supabase part. This guide only covers Vercel. Do one section at a time.

---

## What you’re going to do

1. Put your project on GitHub (so Vercel can use it).
2. Create a Vercel account and connect your GitHub.
3. Tell Vercel to “build” your app and add your secret keys (environment variables).
4. Deploy so your app is live on the internet.

---

## Before you start

- You need a **GitHub account**. If you don’t have one: go to [github.com](https://github.com) and sign up (free).
- Your Polycast project folder is on your computer (e.g. in `Desktop/polycast`). We’ll use the **Terminal** (or **Command Prompt** on Windows) for a few steps.

---

# PART A — Put your project on GitHub

This lets Vercel see and use your code.

---

### Step A1 — Open Terminal (Mac) or Command Prompt (Windows)

- **Mac:** Open **Finder** → **Applications** → **Utilities** → double‑click **Terminal**.
- **Windows:** Press the **Windows** key, type **cmd**, press Enter to open **Command Prompt**.

You’ll see a window with text and a blinking cursor. That’s where you’ll type the commands below.

---

### Step A2 — Go into your project folder

**Only type the line below** (nothing else — not the word “text” or “Type this”).  
In Terminal, type:

```
cd Desktop/polycast
```

Then press **Enter**.

If your project is in **Documents** instead, type this instead:

```
cd Documents/polycast
```

Then press **Enter**.

You should see the path change in the line above the cursor (it might show something like `.../polycast`). That means you’re inside the project.

---

### Step A3 — Turn the folder into a Git repo and save a “snapshot”

Type each of the following **one at a time**. After each line, press **Enter**.  
**Do not type the number or the word “Command” — only the line in the box.**

**Command 1 — type only this line:**
```
git init
```

You might see “Initialized empty Git repository…”. That’s good.

**Command 2 — type only this line:**
```
git add .
```

Nothing exciting will happen; that’s normal.

**Command 3 — type only this line (including the quotes):**
```
git commit -m "Initial Polycast app"
```

You should see something like “X files changed”. That means your project is saved as one snapshot (commit).

---

### Step A4 — Create a new repo on GitHub (in your browser)

1. Go to [github.com](https://github.com) and **log in**.
2. Click the **+** in the top right → **New repository**.
3. **Repository name:** type `polycast` (or any name you like).
4. Leave everything else as is (don’t check “Add a README”).
5. Click the green **Create repository** button.

---

### Step A5 — Connect your computer to that GitHub repo

GitHub will show you a page with commands. You only need the “push” part, but we need to add the “remote” first.

Back in **Terminal**, type this line — but **replace YOUR_USERNAME with your real GitHub username** (the one in the URL when you’re on your new repo page). Only type the one line, then press Enter:

```
git remote add origin https://github.com/YOUR_USERNAME/polycast.git
```

Example: if your username is jake, you’d type exactly:
```
git remote add origin https://github.com/jake/polycast.git
```

Press Enter.

Next, type only this line and press Enter:
```
git branch -M main
```

Next, type only this line and press Enter:
```
git push -u origin main
```

Press Enter. You might be asked for your **GitHub username** and **password**.  
**Important:** For “password”, use a **Personal Access Token**, not your normal GitHub password. To create one: GitHub → your profile picture (top right) → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token**. Give it a name, check **repo**, generate, then copy the token and paste it when the terminal asks for a password.

When the push works, you’ll see something like “Branch 'main' set up to track…”. Your code is now on GitHub.

---

# PART B — Sign up / log in to Vercel

1. Go to [vercel.com](https://vercel.com) in your browser.
2. Click **Sign Up** (or **Log In** if you already have an account).
3. Choose **Continue with GitHub**.
4. Approve Vercel so it can see your GitHub account and repos.

---

# PART C — Create a new project from your GitHub repo

1. On Vercel, click **Add New…** (or **New Project**).
2. You’ll see a list of your GitHub repos. Find **polycast** (or whatever you named it) and click **Import** next to it.
3. You’ll see a **Configure Project** screen. **Don’t click Deploy yet.** We’ll add your secrets first.

---

# PART D — Add your environment variables (your “secrets”)

These are the keys and URLs your app needs (Supabase, APIs, Bluesky, Telegram, etc.). Vercel will store them safely and give them only to your app.

1. On that same **Configure Project** page, find the section called **Environment Variables**.
2. For each row below, type the **Name** exactly as shown, then paste or type the **Value** (from your `.env.local` file or from where you saved them).

Add them **one by one**:

| Name (type exactly)        | Where to get the value                          |
|---------------------------|--------------------------------------------------|
| `SUPABASE_URL`            | Supabase dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API → `service_role` (secret) key |
| `ANTHROPIC_API_KEY`       | Your `.env.local` file (starts with `sk-ant-...`) |
| `OPENAI_API_KEY`          | Your `.env.local` (starts with `sk-proj-...`)    |
| `GOOGLE_AI_API_KEY`       | Your `.env.local`                                |
| `XAI_API_KEY`             | Your `.env.local`                                |
| `BLUESKY_HANDLE`          | e.g. `@polycastai.bsky.social`                   |
| `BLUESKY_APP_PASSWORD`    | Your Bluesky app password                        |
| `TELEGRAM_BOT_TOKEN`      | Your `.env.local`                                |
| `TELEGRAM_CHAT_ID`        | Your `.env.local`                                |

3. **CRON_SECRET** (so only Vercel can trigger your scheduled tasks):
   - Make one up: a long random string, e.g. 20–30 letters and numbers. Example: `polycastSecret2024XyZ789`.
   - Name: `CRON_SECRET`  
   - Value: that string. **Save it somewhere** (e.g. a note on your computer); you might need it later.

4. Leave **NEXT_PUBLIC_BASE_URL** for after the first deploy (we’ll set it in Part F).

5. For each variable, you can leave the checkboxes as they are (Production and Preview are fine). Click **Save** or confirm after each one so they’re all stored.

---

# PART E — Deploy (first time)

1. Still on the **Configure Project** page, scroll down.
2. Click the big **Deploy** button.
3. Wait. Vercel will “build” your app (this can take 1–3 minutes). You’ll see logs and a spinning icon.
4. When it’s done, you’ll see **Congratulations** or a **Visit** button. Click **Visit** (or the link they give you). That’s your live app (e.g. `https://polycast-xxxx.vercel.app`).

If the build **fails**, look at the red error in the log. Often it’s a typo in an environment variable name or a missing one. Fix it under **Settings → Environment Variables**, then redeploy (see Part G).

---

# PART F — Set the “base URL” so the admin page works

1. In Vercel, open your **polycast** project.
2. Go to **Settings** → **Environment Variables**.
3. Add a **new** variable:
   - **Name:** `NEXT_PUBLIC_BASE_URL`
   - **Value:** the URL of your app, e.g. `https://polycast-xxxx.vercel.app` (copy it from the address bar when you visited the app, no slash at the end).
4. Save.
5. Redeploy once so the app picks it up: go to **Deployments** → click the **⋯** on the latest deployment → **Redeploy** → **Redeploy** again to confirm.

---

# PART G — How to redeploy after you change something

- If you change **code** and push to GitHub (e.g. `git add .` then `git commit -m "Update"` then `git push`), Vercel will usually deploy automatically.
- If you only change **environment variables** in Vercel: **Settings** → **Environment Variables** → edit or add → then **Deployments** → **⋯** on latest → **Redeploy**.

---

# You’re done

- Your app is live at the URL Vercel gave you (e.g. `https://polycast-xxxx.vercel.app`).
- **Homepage:** that URL.
- **Admin:** that URL + `/admin` (e.g. `https://polycast-xxxx.vercel.app/admin`).

**Note about cron (scheduled tasks):** On the **free (Hobby) plan**, Vercel allows cron jobs but **each can run at most once per day**. The app is set up so every cron runs once per day (or less): pipeline 9:00 UTC, run-approved 11:00 UTC, resolution 20:00 UTC, price-updater 6:00 UTC (once daily instead of every 6 hours), re-run 10:00 UTC, weekly leaderboard Fridays 18:00 UTC. That keeps you within the free-plan limit. If you ever see a cron-related error again, we can switch to an external scheduler (see below).

**Other options if crons still cause issues:** (1) **External scheduler** — Use a free service like [cron-job.org](https://cron-job.org) to call your Vercel URLs (e.g. `https://your-app.vercel.app/api/cron/pipeline`) on a schedule; in the request headers set `Authorization: Bearer YOUR_CRON_SECRET` so your app accepts it. (2) **Manual runs** — The site and the “Run approved markets” button work without any crons; you’d just run the pipeline/resolution steps manually by visiting those URLs (with the secret in the header) or by upgrading to Vercel Pro for more frequent cron runs.

---

# PART H — “Project already exists” / How to redeploy the same project

- **Don’t** click “Add New” or “New Project” again. That tries to create a **second** project and can say “project already exists.”
- To redeploy your **existing** project:
  1. Go to [vercel.com/dashboard](https://vercel.com/dashboard).
  2. Click your **polycast** project (the one you already created).
  3. Go to the **Deployments** tab.
  4. Click the **⋯** (three dots) on the **latest** deployment.
  5. Click **Redeploy** → confirm **Redeploy**.
- Or: push a new commit to GitHub (e.g. after we fixed the cron settings); Vercel will automatically deploy that commit to the same project.

If any step doesn’t match what you see on screen, tell me exactly what you see (or a screenshot) and we’ll adjust the steps.

---

# PART I — How to run the pipeline (market selection + approval)

After the app is deployed, you can run it in two ways: **automatically (cron)** or **manually**.

---

## Option A — Automatic (Vercel Cron)

If you left the crons in `vercel.json` as-is, Vercel will call your app on a schedule:

| Time (UTC) | What runs |
|------------|-----------|
| **9:00**   | **Pipeline** — Fetches markets via Gemini, writes 20 as “pending” to the DB, sends you a Telegram message. You then open `/admin`, approve the ones you want, and later “Run approved” runs the models and posts. |
| **11:00**  | **Run approved** — Runs the blind+anchored prompts and posts for any markets you’ve already approved. |
| 6:00       | Price updater |
| 10:00      | Re-run job |
| 20:00      | Resolution checker |
| Fri 18:00  | Weekly leaderboard |

So: **Pipeline at 9:00** fills the shortlist and notifies you; **Run approved at 11:00** (or whenever you’ve approved) runs the forecasts. No extra steps unless you want to run things by hand.

---

## Option B — Manual (run it yourself)

**1. Fetch shortlist (Gemini picks 20 markets, saves as pending, sends Telegram)**  
- **From the admin UI:** If your admin page has a “Fetch shortlist” (or similar) button, click it.  
- **Or call the API:**  
  - From your app’s admin: often a button that does `POST /api/admin/fetch-shortlist`.  
  - Or call the cron URL with your secret (so the app knows it’s you):

    ```bash
    curl -X GET "https://YOUR_APP.vercel.app/api/cron/pipeline" \
      -H "Authorization: Bearer YOUR_CRON_SECRET"
    ```

  Replace `YOUR_APP` with your Vercel URL and `YOUR_CRON_SECRET` with the value you set in Vercel env vars.

**2. Approve markets**  
- Open **https://YOUR_APP.vercel.app/admin**.  
- You’ll see the 20 pending markets. Approve the ones you want to forecast.

**3. Run approved (run models and post)**  
- **From the admin UI:** Click the “Run approved” (or similar) button.  
- **Or call the API:**

  ```bash
  curl -X GET "https://YOUR_APP.vercel.app/api/cron/run-approved" \
    -H "Authorization: Bearer YOUR_CRON_SECRET"
  ```

---

## Quick checklist

- **Deploy:** Push code to GitHub (or redeploy from Vercel). Ensure **all** env vars are set in Vercel (including `GOOGLE_AI_API_KEY` for Gemini shortlist).
- **Run shortlist:** Either wait for 9:00 UTC cron or trigger `/api/cron/pipeline` (or admin “Fetch shortlist”) manually.
- **Approve:** Open `/admin`, approve markets.
- **Run forecasts:** Either wait for 11:00 UTC cron or trigger “Run approved” (or `/api/cron/run-approved`) manually.
