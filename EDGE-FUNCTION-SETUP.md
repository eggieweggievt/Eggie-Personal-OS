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
