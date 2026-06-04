# Eugene on Discord — setup (≈10 minutes) 🐙💬

Order matters — do the browser part first, then PowerShell, then back to the browser once.

---

## Part 1 — Browser: create the Discord app (collect 4 values)

1. Go to **discord.com/developers/applications** → **New Application** → name it `Eugene` → Create.
2. On **General Information**, copy two things into a notepad:
   - **APPLICATION ID**
   - **PUBLIC KEY**
3. Left sidebar → **Bot** → **Reset Token** → copy the **TOKEN** (it's only shown once).
4. Get **your own Discord user ID**: in the Discord app → ⚙️ User Settings → **Advanced** → turn ON **Developer Mode** → close settings → right-click your own name in any chat → **Copy User ID**.

You now have 4 values: APP ID · PUBLIC KEY · BOT TOKEN · YOUR USER ID.

## Part 2 — PowerShell: secrets + deploy

```
cd "E:\Documents\Claude\Projects\Personal OS\Eggie-Personal-OS"
```

(If needed: `$env:SUPABASE_ACCESS_TOKEN="sbp_…"`)

One line — paste your real values in place of the CAPS placeholders:

```
npx supabase secrets set DISCORD_APP_ID=APP_ID_HERE DISCORD_PUBLIC_KEY=PUBLIC_KEY_HERE DISCORD_BOT_TOKEN=BOT_TOKEN_HERE DISCORD_OWNER_ID=YOUR_USER_ID_HERE --project-ref clpfyxlenotepuceczbh
```

```
npx supabase functions deploy discord --no-verify-jwt --project-ref clpfyxlenotepuceczbh
```

```
npx supabase functions deploy reminders --no-verify-jwt --project-ref clpfyxlenotepuceczbh
```

Register the slash commands (one time):

```
curl.exe "https://clpfyxlenotepuceczbh.supabase.co/functions/v1/discord?register=1"
```

✓ You should see `{"ok":true,"registered":["/ask","/remind","/task","/capture","/idea","/inspo","/today","/done"]}`.

Commit the new code:

```
git add supabase/functions/discord/index.ts supabase/functions/reminders/index.ts DISCORD-SETUP.md; git commit -m "Eugene on Discord"; git push
```

## Part 3 — Browser: connect + invite

5. Back on **General Information** → **INTERACTIONS ENDPOINT URL** → paste:
   `https://clpfyxlenotepuceczbh.supabase.co/functions/v1/discord`
   → **Save Changes**. (Discord pings the function to verify — if it refuses, the secrets/deploy step above didn't finish.)
6. Invite the bot to your server — open this in a browser (swap in your APP ID):
   `https://discord.com/oauth2/authorize?client_id=APP_ID_HERE&scope=bot+applications.commands&permissions=2048`
   → pick your server → Authorize. *(Being in a mutual server is what lets Eugene DM you.)*
7. Optional: on the **Installation** page, enable **User Install** too — then "Add App → for me" makes Eugene's commands usable in ANY server/DM you're in, visible only to you.

## Part 4 — Test (in Discord, anywhere in your server or in a DM with Eugene)

- `/today` → your day at a glance (instant)
- `/task text: test from discord` → check the Planner tab
- `/ask question: how much art did I do this week?` → "thinking…" then the answer
- `/remind about: in 10 minutes to check that discord works` → within ~5 min of it coming due you should get a **DM from Eugene with ✓ done / 😴 snooze buttons** (and a phone ping if Discord notifications are on)

## What's what (for future-you)

- **`discord` function** = the bot. Verifies Discord's signatures, answers slash commands, runs `/ask` + `/remind` through the same brain as the website (it calls the `analyze` function), executes the actions server-side, handles the DM buttons.
- **`reminders` function** = the cron. Now sends three things when a reminder is due: web push, email, and a **Discord DM with buttons**.
- Per-reminder channels: `email:false` turns email off; DMs and pushes always go (delete the DM if you don't want buttons).
- Adding your boyfriend later: set one more secret `DISCORD_USER_MAP={"his-discord-id":"his-os-tag"}` and his `/ask` etc. hit *his* data.
- Known limit (by design): Eugene can't read normal chat messages — everything goes through `/commands`.
