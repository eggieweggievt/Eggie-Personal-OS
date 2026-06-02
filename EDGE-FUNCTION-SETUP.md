# Turn on the AI brain (the ✨ Analyze button + 🔮 Ask) 🐙

The dashboard's AI runs in a **Supabase Edge Function** called `analyze` — a tiny serverless
function that lives inside *your* Supabase project, holds your Anthropic key safely, and reads your
own content to learn your patterns. The page calls it with one line. ~5 minutes, one-time.

The function code is already written for you at `supabase/functions/analyze/index.ts`.

## 1. Install the Supabase CLI (once)

- **Windows (recommended):** install [Scoop](https://scoop.sh), then:
  ```powershell
  scoop install supabase
  ```
- **Mac:** `brew install supabase/tap/supabase`
- Verify it works: `supabase --version`

## 2. Log in + link this project

Run these from inside the `Eggie-Personal-OS` folder:

```bash
supabase login
supabase link --project-ref clpfyxlenotepuceczbh
```

(`clpfyxlenotepuceczbh` is your project ref — it's the bit in your project URL. The CLI may ask for
the database password you set when you created the project.)

## 3. Add your secret keys

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

That's the only required secret. (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the
function automatically.) Optional: `supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-6` to pin a model.

### Optional — auto-pull your channel numbers

To make the **↻ auto** button on Channel Pulse fill your YouTube subs + Discord members:

```bash
supabase secrets set YOUTUBE_API_KEY=AIza...          # free: console.cloud.google.com → enable "YouTube Data API v3" → create an API key
supabase secrets set YOUTUBE_CHANNEL_ID=UCafRwkDb29wF0MPuZa4zzPA   # your EggieWeggie VT channel
supabase secrets set DISCORD_INVITE=suckegg           # the code from discord.gg/suckegg
supabase secrets set TWITCH_HANDLE=eggieweggievt      # Twitch followers via DecAPI (free, no key)
```

**Channel snapshot (Optimize tab):** the 📡 "Pull @handle" button uses this same `YOUTUBE_API_KEY` to show your
subscribers, total views, video count, and 5 most-recent uploads (with view counts). It's the `channelSnapshot`
mode — added to `analyze`, so **redeploy** (`supabase functions deploy analyze --no-verify-jwt`) after pulling
these changes. Works in demo mode with placeholder numbers until the key + redeploy are in place.

What auto-pulls for free: **YouTube** subs (needs the API key above), **Twitch** followers (DecAPI, no key),
**Discord** members (from the invite, no key). **TikTok / X / Instagram** have no reliable free
auto-count, so those stay manual. (The ↻ button on Channel Pulse passes your handles from CONFIG, so it
works without these secrets — the secrets are only needed for the *weekly cron* to know your handles.)

### Optional — refresh weekly on a schedule

In your Supabase dashboard → **Integrations → Cron → Create job**:
- **Schedule:** `0 9 * * 1` (every Monday 9am UTC)
- **Type:** Supabase Edge Function → `analyze`
- **HTTP body:** `{ "mode": "channelStats" }`

The function writes the numbers into that day's log itself, so your Channel Pulse stays fresh with
no page open. (It uses the `YOUTUBE_CHANNEL_ID` + `DISCORD_INVITE` secrets above.)

> Whenever you change `supabase/functions/analyze/index.ts`, redeploy:
> `supabase functions deploy analyze --no-verify-jwt`

---

## ☀️ Morning briefing email (daily 9am)

A second function, `briefing`, emails you a warm daily summary (today's stream, what's in flight,
week goals, yesterday's habits, this month's money) via **Resend** (free).

**1. Get a Resend key:** sign up at [resend.com](https://resend.com) → **API Keys → Create** → copy it.

**2. Sender address — pick one:**
- *Quickest (test):* leave the default `onboarding@resend.dev`. Resend will deliver it to **your own
  account email** only — fine since the briefing goes to you.
- *Proper (recommended):* in Resend → **Domains → Add** `eggieweggie.ca`, add the DNS records it
  shows, then set `BRIEFING_FROM` below to something like `Eggie OS <os@eggieweggie.ca>`.

**3. Set secrets + deploy:**
```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set BRIEFING_TO=eggie@eggieweggie.ca
# optional once your domain is verified:
# supabase secrets set BRIEFING_FROM="Eggie OS <os@eggieweggie.ca>"
# optional, links the email's button to your live site:
# supabase secrets set BRIEFING_LINK=youruser.github.io/eggie-personal-os
supabase functions deploy briefing --no-verify-jwt
```

**4. Test it now:** in Supabase → **Edge Functions → briefing → Invoke** (or
`supabase functions invoke briefing`). Check your inbox 🐙.

**5. Schedule 9am daily:** Supabase → **Integrations → Cron → Create job**
- **Schedule:** `0 13 * * *`  (that's **9am Eastern** in summer/EDT; use `0 14 * * *` in winter/EST)
- **Type:** Supabase Edge Function → `briefing`
- **HTTP body:** `{}`

It runs on Supabase's servers, so the email arrives even when your computer is off.

## 4. Deploy the function

```bash
supabase functions deploy analyze --no-verify-jwt
```

`--no-verify-jwt` lets the page call the function with your public key (the new `sb_publishable_…`
keys aren't JWTs, so we skip JWT verification and the page calls it directly).

## 5. Use it

Open the dashboard (demo toggle **off**, chip shows `● live`):
- **🎬 Content → open any item → ✨ analyze** → a score, the 4-criteria check, stronger titles
  (tap one to use it), hooks, and a 1S/2M/2L hashtag set — all learning from your past content.
- **🔮 Ask** → ask anything about your content or brand ("what should I film this week?",
  "is my pillar mix healthy?") and get an answer in your voice.

## Notes

- **Cost:** each Analyze / Ask is one Claude API call (a fraction of a cent at your volume). To avoid
  surprises you can set a spend limit in the Anthropic console.
- **Credit-spend safety:** with `--no-verify-jwt` the function is publicly callable by anyone who has
  the URL. For a personal dashboard that's fine; if you ever want to lock it, add Supabase Auth and
  redeploy without that flag.
- **VidIQ:** the function already accepts an optional `vidiq` payload to enrich answers with live
  keyword/competition data. Wiring VidIQ in automatically is the next step once we confirm your VidIQ
  API access — until then, ask me in chat and I'll run VidIQ for any idea.
- **Updating the function later:** edit `supabase/functions/analyze/index.ts`, then re-run
  `supabase functions deploy analyze --no-verify-jwt`.
