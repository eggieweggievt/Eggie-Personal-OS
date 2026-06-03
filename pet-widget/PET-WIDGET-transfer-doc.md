# The AI Pet Widget — transfer doc (port to any OS, any sprite sheet)

**Purpose:** paste this into a fresh Claude chat that's building/extending a personal OS so it can drop in the same draggable, throwable, animated **sprite-sheet pet with an AI chat**. It's 100% front-end (no backend except whatever you already use for AI). A companion file, **`pet-widget.js`**, is the complete drop-in implementation — this doc explains it so Claude can wire it up or rebuild it for a different sprite sheet.

---

## 1. What it is
A little character sprite that lives at the bottom of the page and:
- **walks** back and forth (frame-by-frame sprite animation), occasionally **sits/idles**,
- can be **picked up and thrown** with the mouse/finger — it arcs with **gravity** and **bounces** off the floor and walls, then settles and walks again (desktop-pet / stream-avatar behaviour),
- shows a **greeting speech bubble** now and then,
- opens an **AI chat box that stays anchored to it** when you tap (not drag) it — the pet stays visible and sits while you chat,
- stays **clear of your corner buttons** so they remain clickable, and **holds still in reduced-motion / "calm" mode.**

## 2. Architecture (the whole idea)
It's a **sprite sheet** + a **per-frame animation loop** + **simple physics** + a **chat panel**, all vanilla JS:
- The sheet is one image with several poses. You display **one frame at a time** by setting a fixed-size element's `background-image` to the sheet and shifting `background-position` to the frame's rectangle (the classic CSS-sprite technique).
- A `requestAnimationFrame` loop advances the **walk frames** (~every 150 ms) while translating the element horizontally; on each wall it flips direction and **mirrors** the sprite with `transform: scaleX(-1)`.
- **Pointer events** drive pick-up/drag/throw. Release velocity (from the last few pointer samples) becomes throw velocity; a gravity integrator does the arc + bounce.
- The **AI** is abstracted behind a single `ask(question) => Promise<string>` callback, so it plugs into whatever you already have (a Supabase Edge Function, an "Ask the OS" endpoint, any `fetch`). The widget never talks to a specific backend itself.

🔒 **Keep these or it breaks:** the frame rectangles must match your sheet; `image-rendering: pixelated` (so upscaled sprites stay crisp, not blurry); the bounds that keep it off your buttons; and the `ask()` abstraction.

## 3. 🔒 Getting the frame rectangles from ANY sprite sheet (do this first)
Most hand-drawn sheets are **not** a tidy uniform grid, so don't guess. Measure them. Serve the sheet from the **same origin** as the page (so the canvas isn't tainted), then run in the console:

```js
// returns { sheetW, sheetH, rows:[ [ {x,y,w,h}, ... ], ... ] }
PetWidget.measure("your-sheet.png").then(r => console.log(JSON.stringify(r)));
```

How it works: it draws the sheet to a canvas, reads the alpha channel, finds horizontal **rows** of non-transparent pixels, and within each row finds the **sprite boxes** by the transparent gutters. Pick:
- the **row whose array has your walk frames** (e.g. a row of 4) → that's `walk`,
- a single isolated frame (often the first one) → that's `sit` (idle).

(If you don't have `PetWidget` yet, the same routine is the `measure()` function inside `pet-widget.js`, and the technique is: load image → `drawImage` to canvas → `getImageData` → project alpha onto Y to find row bands, then onto X within each band to find frames.)

Example output for the Mifu sheet `fox.png` (164×210): the walk cycle is `[{x:6,y:52,w:35,h:32},{x:44,y:53,w:38,h:31},{x:88,y:52,w:35,h:32},{x:130,y:53,w:34,h:31}]` and `sit` is `{x:6,y:10,w:35,h:32}`.

## 4. Drop-in usage
Include the file and init it with your config:

```html
<script src="pet-widget.js"></script>
<script>
  PetWidget.init({
    sheet: "fox.png", sheetW: 164, sheetH: 210,        // sheet image + its natural pixel size
    walk: [ {x:6,y:52,w:35,h:32},{x:44,y:53,w:38,h:31},
            {x:88,y:52,w:35,h:32},{x:130,y:53,w:34,h:31} ],
    sit:  {x:6,y:10,w:35,h:32},
    scale: 2.1,            // upscale factor (sprites are small; pixelated keeps it crisp)
    faces: "right",        // which way the art faces by default ("right" | "left")
    speed: 44,             // walk px/sec
    leftClear: 72, rightClear: 72,   // px kept clear of each screen edge (room for your corner buttons)
    title: "Kiko", subtitle: "your snowfox helper",
    avatar: "Kiko Sit.png",          // round chat-header icon (optional; falls back to a gradient)
    accentFrom: "#758ac6", accentTo: "#ff9ed8",   // chat/bubble theme colours
    greetings: ["Konfuyu~! Need anything? ❄️", "Pspsps… ask me something! 🦊"],
    ask: async (q) => {              // ← YOUR AI. Return the answer string.
      const { data, error } = await SB.functions.invoke("ai", { body:{ mode:"ask", input:{ question:q } } });
      if (error) throw new Error(error.message);
      return (data && data.answer) || "hmm, ask me again?";
    }
  });
</script>
```

`PetWidget.init` returns `{ open(), close(), state }` if you want to control it programmatically.

## 5. Wiring the AI (`ask`)
The pet is backend-agnostic. `ask(question)` just has to resolve to a **string**. Examples:
- **Supabase Edge Function** (like Mifu's "ask" mode): `SB.functions.invoke("ai", { body:{ mode:"ask", input:{ question } } })` → return `data.answer`.
- **Any HTTP endpoint:** `fetch("/api/ask", {method:"POST", headers:{'content-type':'application/json'}, body:JSON.stringify({q})}).then(r=>r.json()).then(j=>j.answer)`.
- **Reuse your existing "Ask the OS"** handler — just call it and return its text.
> The AI key/secret must live server-side (an Edge Function or your API), never in this front-end. The widget only ever sends a question and shows the returned text.

## 6. ✏️ Re-skin checklist (make it yours)
1. **Sprite sheet:** set `sheet`, `sheetW`, `sheetH`, and the measured `walk` + `sit` rectangles. Check `faces` matches your art (flip if it walks backwards).
2. **Crisp, not blurry:** keep `image-rendering: pixelated` (it's on by default; pass `smooth:true` only if your art is high-res and you want bilinear scaling). Pick a `scale` that looks good (2–2.4 for ~35px sprites).
3. **Stay off your buttons:** set `leftClear` / `rightClear` to the width of your bottom-corner buttons + a margin, and make sure those buttons have a **higher z-index** than `#pet` (the pet is `z-index:9991`; the chat is `9994`).
4. **Theme:** `accentFrom`/`accentTo` (chat colours), `avatar` (round chat icon), `title`/`subtitle`, `greetings`, `font`.
5. **Backend:** point `ask()` at your AI.
6. Nothing else — no build step, no extra libraries.

## 7. 🔒 Non-negotiables (don't break these)
1. **Measure the frames** (don't assume a uniform grid). Wrong rectangles = the pet shows two half-foxes.
2. **`image-rendering: pixelated`** + the correct `sheetW/sheetH` — that's the crispness. (Mifu's looked blurry purely because the sheet size was guessed wrong.)
3. **Tap vs drag:** if the pointer moved < ~4px it's a **tap** → open chat; otherwise it's a **drag/throw** → never open chat. Keep that threshold.
4. **Pet stays visible while chatting** and the **chat is anchored above it** (re-position every frame from the pet's x/y). Don't hide the pet.
5. **Walk bounds clear the corner buttons**, and the **buttons sit above the pet** in z-index so they're always clickable even mid-throw.
6. **Reduced-motion / calm mode → sit still** (no walking, no throw idle jitter).
7. The **`ask()` abstraction** — the widget must not contain any API keys or be hard-wired to one backend.

That's the whole pet. Measure your sheet (§3), fill the config (§4), point `ask()` at your AI (§5), run the §6 checklist. 🐙❄️🦊
