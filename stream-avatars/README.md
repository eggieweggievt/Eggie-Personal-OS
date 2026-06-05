# Chat Buddies 🐙🎮

Every Twitch chatter gets a little walking sprite on your stream. No installed program, no backend, no login — just one web page that OBS loads as a Browser Source. (A free browser-based alternative to the Stream Avatars desktop app — not affiliated with it.)

## Scripts in this folder

| Script | When |
|--------|------|
| `setup.ps1` | first time only — creates the repo folder + git |
| `update.ps1` | every time files change — copies + pushes to GitHub |

Right-click → **Run with PowerShell**.

Your links once live:

```
Setup page (start here!):  https://eggieweggievt.github.io/chat-buddies/setup.html
Overlay:                   https://eggieweggievt.github.io/chat-buddies/?channel=eggieweggievt
Picker:                    https://eggieweggievt.github.io/chat-buddies/picker.html
```

**Easiest path:** open the setup page, type your channel, drag the size slider, hit *Copy link*, paste into OBS. The "Try it" button opens a preview with fake avatars so you can arrange your scene.

**Prefer editing a file?** All defaults (channel, size, bubbles…) live in the `EASY SETTINGS` block at the very top of `index.html`, written in plain English — with your channel set there, the bare overlay URL works with no `?channel=` at all.

## ⚠️ OBS not showing avatars? Check these in order

1. **Is the page live?** Open the overlay URL above in your normal browser with `&debug=1` added at the end. If you see a GitHub **404**, the site isn't published yet: make sure the repo exists and is pushed (run `update.ps1`), then on GitHub → repo **Settings → Pages → Branch: main, / (root) → Save**. Wait a minute, try again.
2. **An empty screen is normal!** Without `debug=1`, nothing appears until someone chats. Type anything in your own Twitch chat and your avatar pops in. (Tip: add `&debug=1` to the OBS URL while setting up, remove it after.)
3. **Don't use "Local file"** in the OBS Browser Source — that checkbox can't pass the `?channel=` part. Paste the full URL into the **URL** box instead.
4. After changing the URL, right-click the source → **Refresh cache of current page**.
5. Browser source settings: Width **1920**, Height **1080**, FPS **Custom 60** (or 30), **uncheck** "Shutdown source when not visible", leave "Refresh browser when scene becomes active" off.
6. Still stuck? Right-click the source → **Interact** — if you see the pink help card, the `?channel=` part is missing from the URL.

## Chat commands (for viewers)

| Command | What happens |
|---------|--------------|
| (any message) | their avatar appears + speech bubble |
| `!jump` | little hop |
| `!dance` | wiggle dance |
| `!spin` | fast spinny twirl |
| `!wave` | hop + 👋 |
| `!yeet` | launched across the screen 🚀 |
| `!boop name` | runs over and boops them |
| `!hug name` | runs over for a hug 💕 |
| `!duel name` | runs over — random loser gets yeeted 🏆 |
| `!lurk` | cozy nap 💤 |
| `!gear` | lists the channel's gear sets |
| `!items axe` | equip a gear piece — `!{set} {piece}` (`!items none` removes, `!items` alone lists pieces) |
| `!hide` | avatar leaves |
| `!join` | appear (only needed in join mode) |

> **Color skins are paused.** The colors are privately commissioned full sheets and are NOT published as viewer skins. Only two (`trans`, `bi`) ship to the site, in `skins/`, purely so the debug/live preview can show examples. The other five never leave your computer, and the whole `stream-avatars/eggie/` folder is gitignored in Eggie-Personal-OS so it can't be pushed by accident. `!skin` in chat replies with a friendly "coming soon."

**Default gear (ships with the site):** your commissioned pack's gear is baked in as the `items` set — `!items axe`, `!items crown`, `!items guts`. These are frame-animated sheets (a matching cell for every avatar frame), so they track the avatar's animation pixel-for-pixel. The broadcaster wears the crown by default until you change role gear on the setup page.

**Gear (accessories):** on the setup page you upload your own transparent **PNG pieces** into named **gear sets** (like `hats`), position each one on a live walking preview (X/Y sliders + size), and choose per set whether it draws **behind** the avatar (capes/wings) and whether it **flips** when the avatar turns. Viewers equip with `!{set} {piece}` — saved to their Twitch account. Per-set one piece at a time, multiple sets stack (hat + cape). You can also assign gear by role (Broadcaster/Mods/VIPs/Subs); a viewer's own pick wins.

**Viewer page:** share `https://eggieweggievt.github.io/chat-buddies/picker.html?channel=eggieweggievt` — a gallery where viewers sign in with Twitch and pick their gear. (Needs the Twitch app Client ID step below before sign-in works; gear commands in chat always work with zero setup.)

**Full animations:** the overlay uses your artist's complete animation set — animated idle, the sit animation for `!lurk`, and real jump frames when thrown. Labels get role badges: 👑 broadcaster, 🛡️ mods, 💎 VIPs, 💜 subs.

## Role sprites 👑

On the setup page, "Who uses this sprite?" lets you upload a different sprite for **Subscribers, VIPs, Mods, and the Broadcaster**. Chatters automatically get the sprite of their highest role; everyone else uses the Everyone sprite. Great sub perk!

## One-time: database setup (Supabase, ~2 minutes) ⚠️ do this first

Saving anything on the setup page (sprites, gear, role gear) and cross-machine skin memory need this once. A 404 "couldn't save" means you haven't done it yet:

1. Go to [supabase.com](https://supabase.com) → your project → **SQL Editor**
2. Open `RUN-THIS-ONCE-supabase.sql` in Notepad, copy ALL of it, paste, click **Run**

That's it — it sets up everything (skins, gear, custom sprites, image storage) and is safe to run twice. (The older `avatar-skins-setup.sql` / `custom-sprites-setup.sql` / `accessories-setup.sql` files are now bundled inside it.)

## Custom sprites — bring your own character 🎨

On the **setup page** you can upload your own sprite — including its **full animation sheet** — and it's remembered for your channel:

- **PNG animation sheet** — all animation rows on one transparent sheet, like the default sprite. Rows are detected automatically by scanning transparency, then you map them: idle row, walk row, and optional nap (`!lurk`) and jump rows. A standard 5-row sheet (idle/walk/sit/stand/jump) maps itself.
- **ZIP of frame images** — name them `idle1.png`, `walk1.png`, `sit1.png`, `jump1.png`, … and they're sorted into animations by name and stitched into a sheet for you.

Custom sprites get the full treatment: animated idle, the nap animation for `!lurk`, and jump frames when thrown — same as the default. Skipped rows just reuse the idle frame.

Hit **Save my sprite** and every stream on every PC uses it from then on (the overlay checks for your sprite when it loads — refresh the browser source in OBS after saving). **Back to the default sprite** un-remembers it.

## Viewer page setup (~5 minutes, one-time)

The viewer page (`picker.html`) is a gallery where viewers sign in with Twitch and choose their gear. (Chat commands always work without this — the page is the pretty browsable version.)

1. Go to [dev.twitch.tv/console](https://dev.twitch.tv/console) → **Register Your Application**
   - Name: anything (e.g. `eggie-chat-buddies`)
   - OAuth Redirect URL: `https://eggieweggievt.github.io/chat-buddies/picker.html`
   - Category: Website Integration → Create → copy the **Client ID** (no secret needed)
2. Open `picker.html` in Notepad, find `PASTE_YOUR_TWITCH_CLIENT_ID_HERE` near the top, paste your Client ID
3. Run `update.ps1`

**Optional hardening** — deploy the verifier function so nobody can spoof another viewer's gear. In PowerShell, one line at a time (same Supabase CLI you used for Eggie OS):

```
cd "E:\Documents\Claude\Projects\Personal OS\Eggie-Personal-OS"
supabase secrets set TWITCH_CLIENT_ID=your_client_id_here
supabase functions deploy avatar-skin --no-verify-jwt
```

(Note: chat gear commands write directly to the table, so keep the open policies if you want them working — the picker works either way.)

## URL options (add after `?channel=...` with `&`)

| Option | Default | Meaning |
|--------|---------|---------|
| `max=50` | 50 | most avatars at once (oldest leave first) |
| `scale=1.1` | 1.1 | sprite size |
| `bubbles=0` | on | turn speech bubbles off |
| `join=1` | off | avatars only appear on `!join` |
| `despawn=15` | 15 | minutes of silence before fading out |
| `calm=1` | off | freeze everyone (reduced motion) |
| `debug=1` | off | 20 fake avatars (incl. two preview color examples + gear) + FPS meter |

## Making changes later

Edit files in this folder, then run `update.ps1`. That's it.

## Swapping the sprite sheet

Replace `sheet.png` with any sheet using the same layout (96×96 cells, rows: idle, walk, sit, stand, jump — 7 frames each). Different layout? Edit the sprite block at the top of `index.html`.
