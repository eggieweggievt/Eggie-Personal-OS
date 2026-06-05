# OC Hub 🦄

A candy-pastel home for original characters — built on the Eggie-OS foundation.
One `index.html`, vanilla JS, Supabase storage, hosted on GitHub Pages.

## Tabs
🏠 Home (modular drag/resize widgets) · 🎭 Characters (gallery + detail page with palette & freeform ref board) · 📖 Lore · 📚 Story arcs (kanban) · 💞 Ships · 💡 Ideas + inspiration vault · ⚙️ Settings

## Data
Shares the main OS's Supabase project (`daily_logs`, user `eggie`). **Everything** lives under `oc`-prefixed keys on the sentinel row (`2000-01-01`): `ocs`, `ocLore`, `ocShips`, `ocArcs`, `ocIdeas`, `ocInspo`, `ocStickies`, `ocLayouts`, `ocAppConfig`. No migrations, ever — the two sites never collide.

## Ship a change
```
cd "E:\Documents\Claude\Projects\OC-Hub"
git add index.html
git commit -m "describe the change"
git push
```
`git push` is all it takes — GitHub Pages redeploys automatically (give it ~1 minute).

## Files
- `index.html` — the whole app
- `pet-widget.js` + `pet-widget/` — Eugene, visiting from the main OS 🐙
