# Eggie OS 🐙

A gentle, single-file VTuber content operating system — content pipeline, spoon-theory habits,
money in/out + savings, sponsor pitch builder, and a weekly review. Runs straight from
`index.html` (no build step) and talks directly to Supabase.

## Run it

- **Just open `index.html`** in a browser — it starts in demo mode (fake data, no backend).
- To make it yours, it's already wired to a Supabase project via the `CONFIG` block at the top of
  `index.html` (your project URL + publishable key). The top-right chip shows `● live` when connected.

## Database

Create a Supabase project, open **SQL Editor → New query**, paste all of
`supabase/eggie-os-setup.sql`, and **Run**. That builds every table the app needs.

## Deploy to GitHub Pages

Push this repo to GitHub, then **Settings → Pages → Deploy from a branch → `main` / `/(root)`**.
Your dashboard goes live at `https://<you>.github.io/<repo>/`.

## Security note

The page uses your **publishable (public)** Supabase key, which is safe to expose in page source.
Access is governed by the RLS policies in the setup script. For a personal single-user dashboard
this is fine; to lock it to just you, add Supabase Auth (email magic link) and scope the policies
to `auth.uid()`.

Made with 💗 — `@EggieWeggieVT`
