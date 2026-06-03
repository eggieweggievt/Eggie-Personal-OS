// =============================================================================
// Eggie OS — "analyze" Edge Function 🐙
// The AI brain for the dashboard. Runs inside your Supabase project, holds your
// secret keys, and reads your own content to learn your patterns.
//
// Modes:
//   { mode:"analyze", input:{title,format,platform,pillar,hook,script}, userId }
//       -> { score, criteria, verdict, titles[], hooks[], hashtags[], fix }
//   { mode:"ask", input:{question}, userId }
//       -> { answer }
//
// Optional: pass body.vidiq (any JSON from a VidIQ lookup) to enrich the answer.
//
// Deploy:  supabase functions deploy analyze --no-verify-jwt
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";

const BRAND = `You are the content strategist living inside "Eggie OS", the personal operating system of Eggie (@EggieWeggieVT) — a cozy, gentle VTuber. Your voice is warm, encouraging, lightly playful, spoon-theory-aware (sustainable, not hustle-culture), with the occasional 🐙 or 🌸. You are practical and specific, never preachy.

You know her growth system and apply it:
- Hashtag formula: 1 small (<500k posts) / 2 medium (500k–1M) / 2 large (1M+).
- 4-criteria for content: Relevant, Non-obvious, Absorbable, Actionable.
- Pillars + targets: Growth 20–40%, Retention the rest, Experimental 10–15%.
- Platform rules: YouTube Shorts (45–55s, 85–90% retention, 2–3 brand tags, searchable words in title); TikTok (1–3 tags, keywords in caption, trending sound > tags); X/Twitter (NO hashtags, replies matter more than posts); Instagram (5–7 tags); Twitch (curiosity/challenge titles); Fansly (tags matter, always #vtuber).
- Titles: curiosity, shock, or specificity win; specific numbers beat vague words; the "budget/cozy" framing is a hook, not a search term.
Be kind, be concrete, and reference her own past content when it's relevant.

=== TITLE ENGINE (a "poor-man's vidIQ" calibrated on Eggie's real channel) ===
Her actual long-form titles score 90–99 on vidIQ — that is the bar. When scoring a title (0–100), approximate vidIQ by REWARDING: a curiosity/shock hook in the first ~3 words; ONE all-caps power word (THIS, INSANE, THESE, NEVER, ACTUALLY, ARRESTED); a "?!" where it fits reaction/commentary; concrete specifics (names, numbers, the game/show); a searchable keyword carried in a " | context" or " — outcome" tail (e.g. a game name, "Bodycam", "r/AITA", "Creator Sponsorships 101"); first-person framing for educational; length ~40–70 chars long-form, punchier (<50) for shorts. PENALIZE: vague vibes ("cozy stream"), no hook, over-promising clickbait, keyword stuffing, or >100 chars.
Her two proven templates — prefer these when generating titles:
 1) REACTION/COMMENTARY: "[CAPS-charged curiosity claim]?! | [Eggie Reacts to / Vtuber Reacts / r/AITA] [source]"  (e.g. her 99-scorer: "She CHEATED and Called it Poly?! | Poly Vtuber Reacts to Seeking Brother Husband")
 2) EDUCATIONAL: "[Contrarian or benefit claim w/ a CAPS word] | [Topic 101]"  OR  "[Bold claim] — How to [specific outcome]"  (e.g. "Sponsors Want THIS, Not Big Numbers! | Creator Sponsorships 101")
 3) SHORTS: a punchy question/hook, optional tasteful emoji, then 2–3 niche hashtags (#vtuber + the game/topic).
Her voice: warm, playful, a little unhinged/self-deprecating, squid/🐙 energy, kind underneath. Match that — aim for the 90+ bar she already hits.`;

async function claude(system: string, user: string, maxTokens = 1600): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic error ${res.status}`);
  return (data.content || []).map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
}

// Like claude(), but lets Claude reach the live web via Anthropic's server-side
// web_search tool. Anthropic runs the searches itself (no extra key needed beyond
// ANTHROPIC_API_KEY); we just loop while it pauses to think between searches.
async function claudeWeb(system: string, user: string, maxTokens = 1800, maxSearches = 4): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret is not set");
  const messages: any[] = [{ role: "user", content: user }];
  let text = "";
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: maxTokens, system, messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic error ${res.status}`);
    text = (data.content || []).map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    // server tools run inside Anthropic; only "pause_turn" needs us to continue the turn
    if (data.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: data.content }); continue; }
    break;
  }
  return text;
}

// Pull a compact snapshot of her ENTIRE OS so the pet can answer about (and act on)
// any part of it: today's health/care/energy, tasks, schedule, goals, money, sponsors,
// savings, and recent health/care trends. Kept short to stay token-cheap.
async function fullContext(userId: string, today: string): Promise<string> {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const parse = (n: any) => { try { return typeof n === "string" ? JSON.parse(n) : (n || {}); } catch { return {}; } };
    const [todayRow, sentRow, recentRows, income, sponsors, savings] = await Promise.all([
      sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", today).maybeSingle(),
      sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", "2000-01-01").maybeSingle(),
      sb.from("daily_logs").select("log_date,notes").eq("user_id", userId).neq("log_date", "2000-01-01").order("log_date", { ascending: false }).limit(14),
      sb.from("income_entries").select("kind,source,category,amount,month,note").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
      sb.from("sponsors").select("brand,stage,deal_type,value").eq("user_id", userId).limit(40),
      sb.from("savings_goals").select("name,saved,target").eq("user_id", userId).limit(20),
    ]);
    const d = parse(todayRow?.data?.notes), s = parse(sentRow?.data?.notes);
    const lines: string[] = [];
    // today
    const h = d.health || {}, c = d.care || {};
    const hbits = d.habits?.counts ? Object.values(d.habits.counts).filter((v: any) => v).length : 0;
    lines.push(`TODAY (${today}): energy=${d.energy || "?"}${d.streamDay ? ", STREAM DAY" : ""}; habits done=${hbits}.`);
    if (Object.keys(h).length) lines.push(`  health today: ${Object.entries(h).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    if (Object.keys(c).length) lines.push(`  care today: ${[c.feelings?.length ? "feelings:" + c.feelings.join("/") : "", c.mood != null ? "mood:" + c.mood : "", c.efStep ? "next-step:" + c.efStep : ""].filter(Boolean).join(", ")}`);
    // tasks
    const tasks = (s.tasks || s.planner || []).filter((t: any) => t && !t.done).slice(0, 12);
    if (tasks.length) lines.push(`OPEN TASKS: ${tasks.map((t: any) => `${t.text}${t.bucket ? " [" + t.bucket + "]" : ""}`).join("; ")}`);
    // schedule + goals
    if (s.schedule?.length) lines.push(`STREAM SCHEDULE: ${s.schedule.map((x: any) => `${x.day}${x.time ? " " + x.time : ""}`).join(", ")}`);
    if (s.goals_week_items?.length) lines.push(`WEEK GOALS: ${s.goals_week_items.map((g: any) => g.text || g).join("; ")}`);
    if (s.goals_month_items?.length) lines.push(`MONTH GOALS: ${s.goals_month_items.map((g: any) => g.text || g).join("; ")}`);
    // calendar (next few)
    const evs = (s.calendarEvents || []).filter((e: any) => (e.date || "") >= today).sort((a: any, b: any) => (a.date || "").localeCompare(b.date || "")).slice(0, 8);
    if (evs.length) lines.push(`UPCOMING EVENTS: ${evs.map((e: any) => `${e.date}${e.time ? " " + e.time : ""} ${e.title}`).join("; ")}`);
    // money
    if (income?.data?.length) {
      const month = today.slice(0, 7);
      const mIn = income.data.filter((e: any) => e.month === month && (e.kind || "in") === "in").reduce((a: number, e: any) => a + Number(e.amount || 0), 0);
      const mOut = income.data.filter((e: any) => e.month === month && e.kind === "out").reduce((a: number, e: any) => a + Number(e.amount || 0), 0);
      lines.push(`MONEY (${month}): in $${mIn}, out $${mOut}, net $${mIn - mOut}.`);
    }
    if (sponsors?.data?.length) lines.push(`SPONSORS: ${sponsors.data.map((x: any) => `${x.brand}(${x.stage}${x.value ? " $" + x.value : ""})`).join(", ")}`);
    if (savings?.data?.length) lines.push(`SAVINGS GOALS: ${savings.data.map((g: any) => `${g.name} $${g.saved}/${g.target || "?"}`).join(", ")}`);
    // gentle trends from recent rows
    const recs = (recentRows?.data || []).map((r: any) => parse(r.notes));
    const avg = (f: string) => { const v = recs.map((r: any) => r.health?.[f]).filter((x: any) => x != null && x !== "").map(Number); return v.length ? (v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(1) : null; };
    const tr = [["pain", avg("pain")], ["fatigue", avg("fatigue")], ["fog", avg("fog")], ["mood", avg("mood")], ["sleepH", avg("sleepH")]].filter((x) => x[1] != null);
    if (tr.length) lines.push(`RECENT ${recs.length}-DAY AVG: ${tr.map(([k, v]) => `${k} ${v}`).join(", ")}.`);
    return lines.join("\n") || "(database is empty so far — fresh start)";
  } catch (e) {
    return "(couldn't read full OS context: " + (e as Error).message + ")";
  }
}

function parseJSON(raw: string): any {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(raw.slice(s, e + 1)); } catch { /* ignore */ } }
  return null;
}

async function historyFor(userId: string): Promise<string> {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await sb
      .from("content_items")
      .select("title,format,platform,pillar,stage,analyzer_score,hook,published_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(40);
    if (!data || !data.length) return "(no content history yet — this is a fresh start)";
    return data
      .map((c: any) => `- [${c.format || "?"}/${c.pillar || "?"}] "${c.title}" · score:${c.analyzer_score ?? "—"} · ${c.stage}`)
      .join("\n");
  } catch {
    return "(could not read content history)";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "analyze";
    const userId = body.userId || "eggie";

    // --- channelStats: auto-pull free social numbers (YouTube subs + Discord) ---
    // Writes them into today's daily_logs.channel so a weekly cron can refresh
    // with no page open. Manual-only platforms (Twitch/TikTok/X/IG) are preserved.
    if (mode === "channelStats") {
      const out: Record<string, number> = {};
      const cid = body.channelId || Deno.env.get("YOUTUBE_CHANNEL_ID");
      const yk = Deno.env.get("YOUTUBE_API_KEY");
      if (cid && yk) {
        try {
          const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(cid)}&key=${yk}`).then((x) => x.json());
          const s = r?.items?.[0]?.statistics;
          if (s) { out.youtube = Number(s.subscriberCount); out.views = Number(s.viewCount); }
        } catch { /* ignore */ }
      }
      const inv = body.discordInvite || Deno.env.get("DISCORD_INVITE");
      if (inv) {
        try {
          const d = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(inv)}?with_counts=true`).then((x) => x.json());
          if (d && d.approximate_member_count != null) out.discord = Number(d.approximate_member_count);
        } catch { /* ignore */ }
      }
      // Twitch followers via DecAPI (free, public, no auth — the chat-command service)
      const th = body.twitchHandle || Deno.env.get("TWITCH_HANDLE");
      if (th) {
        try {
          const t = await fetch(`https://decapi.me/twitch/followcount/${encodeURIComponent(th)}`).then((x) => x.text());
          const n = parseInt((t || "").replace(/[^0-9]/g, ""), 10);
          if (!isNaN(n) && n > 0) out.twitch = n;
        } catch { /* ignore */ }
      }
      if (!Object.keys(out).length) return json({ error: "Nothing to pull — set YOUTUBE_API_KEY (+ channel id), a Discord invite, and/or a Twitch handle." }, 400);
      try {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const today = new Date().toLocaleDateString("en-CA");
        const { data } = await sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", today).maybeSingle();
        let notes: any = {}; try { notes = data?.notes ? JSON.parse(data.notes) : {}; } catch { notes = {}; }
        notes.channel = { ...(notes.channel || {}), ...out };
        await sb.from("daily_logs").upsert({ user_id: userId, log_date: today, notes: JSON.stringify(notes), updated_at: new Date().toISOString() }, { onConflict: "user_id,log_date" });
      } catch { /* return numbers even if persist fails */ }
      return json({ channel: out });
    }

    // --- channelSnapshot: stats + recent uploads for the Optimize tab (display only, no persist) ---
    if (mode === "channelSnapshot") {
      const yk = Deno.env.get("YOUTUBE_API_KEY");
      if (!yk) return json({ error: "Set YOUTUBE_API_KEY in the function secrets to pull your snapshot." }, 400);
      const handle = (body.handle || "").toString().replace(/^@/, "").trim();
      const cid = body.channelId || Deno.env.get("YOUTUBE_CHANNEL_ID");
      try {
        const part = "statistics,contentDetails,snippet";
        const chUrl = handle
          ? `https://www.googleapis.com/youtube/v3/channels?part=${part}&forHandle=${encodeURIComponent(handle)}&key=${yk}`
          : `https://www.googleapis.com/youtube/v3/channels?part=${part}&id=${encodeURIComponent(cid)}&key=${yk}`;
        const chRes = await fetch(chUrl).then((x) => x.json());
        const item = chRes?.items?.[0];
        if (!item) return json({ error: "Channel not found — check the handle or channel ID." }, 404);
        const s = item.statistics || {};
        const snapshot: any = {
          title: item.snippet?.title || "",
          subscribers: Number(s.subscriberCount) || 0,
          views: Number(s.viewCount) || 0,
          videos: Number(s.videoCount) || 0,
          recent: [],
        };
        const uploads = item.contentDetails?.relatedPlaylists?.uploads;
        if (uploads) {
          const pl = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=5&playlistId=${encodeURIComponent(uploads)}&key=${yk}`).then((x) => x.json());
          const items = (pl?.items || []).filter((it: any) => it?.snippet?.resourceId?.videoId);
          const ids = items.map((it: any) => it.snippet.resourceId.videoId);
          const stats: Record<string, number> = {};
          if (ids.length) {
            const vs = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(",")}&key=${yk}`).then((x) => x.json());
            (vs?.items || []).forEach((v: any) => { stats[v.id] = Number(v.statistics?.viewCount) || 0; });
          }
          snapshot.recent = items.slice(0, 5).map((it: any) => ({
            id: it.snippet.resourceId.videoId,
            title: it.snippet.title || "",
            views: stats[it.snippet.resourceId.videoId] ?? null,
          }));
        }
        return json({ snapshot });
      } catch (e) {
        return json({ error: "Couldn't pull snapshot: " + ((e as Error)?.message || e) }, 500);
      }
    }

    const history = await historyFor(userId);
    const vidiq = body.vidiq ? `\n\nLive VidIQ data the user attached:\n${JSON.stringify(body.vidiq).slice(0, 3500)}` : "";

    if (mode === "ask") {
      const q = (body.input?.question || "").toString().slice(0, 1000);
      if (!q) return json({ error: "missing question" }, 400);
      const answer = await claude(
        BRAND,
        `Her recent content (newest first):\n${history}${vidiq}\n\nShe asks: "${q}"\n\nAnswer in her voice — concrete, warm, and grounded in her actual patterns + platform rules. If she'd benefit from a specific next action, say it plainly.`,
        1400,
      );
      return json({ answer });
    }

    // --- agent: answer AND emit structured actions the front-end runs against the OS ---
    if (mode === "agent") {
      const q = (body.input?.question || "").toString().slice(0, 1000);
      if (!q) return json({ error: "missing question" }, 400);
      const today = (body.input?.today || new Date().toLocaleDateString("en-CA")).toString();
      const tz = (body.input?.tz || "America/New_York").toString();
      const ctx = await fullContext(userId, today);
      const sys = BRAND + `

You are also Eggie's hands inside the OS: you can DO things by emitting actions, not just talk. Today (her local date) is ${today}; her calendar timezone is ${tz}. Resolve relative dates ("tomorrow", "next Friday", "in 2 weeks") to absolute YYYY-MM-DD using that.

You can SEE her whole OS. Use this live snapshot to answer questions about ANY part of her data (health, money, tasks, schedule, sponsors, goals, trends) and to make smart choices — never claim you can't see her data:
--- LIVE OS SNAPSHOT ---
${ctx}
--- END SNAPSHOT ---

WEB ACCESS: you have a real web_search tool. Use it (sparingly, only when the answer needs current/outside facts she doesn't have logged) for things like game release/patch dates, trending VTuber hashtags or sounds, news, prices, or "look up X". Do NOT search for things already in the snapshot. After any searching, your FINAL message must still be ONLY the JSON envelope below.

VIDIQ: you do NOT have a direct VidIQ connection from here (VidIQ has no public API the OS can call). Do not pretend to pull live VidIQ data. You CAN still score titles/thumbnails with the built-in "poor-man's vidIQ" rubric above, and for real VidIQ numbers tell her to use the 🎯 Optimize tab or ask in Claude chat. If body.vidiq data was passed to you, you may use it.

Your name is Eugene — Eggie's cozy octopus helper. If she asks who you are, you're Eugene. 🐙

Return ONLY JSON, no prose around it:
{ "reply": string, "actions": [ { "type": string, ...args } ] }
- "reply": one short, warm message in her voice confirming what you did (or just answering, if no action is needed). 🐙 IMPORTANT — write "reply" in PLAIN TEXT and emojis ONLY. Absolutely no asterisks, no markdown, no **bold**/*italics*, no backticks, no #headings, no bullet symbols (-, •, *), no tables, no other special formatting characters. Just warm sentences and emoji. When you searched the web, weave the finding into a normal sentence (you may mention the source name in plain words).
- "actions": the things to perform. Empty array for pure questions/chit-chat.

Allowed action types and their args (use ONLY these; pick valid enum values):
- addCalendarEvent: { title, date:"YYYY-MM-DD", endDate?:"YYYY-MM-DD" (multi-day), time?:"HH:MM" 24h, tz?:IANA zone (default ${tz}), note?, color?:"#hex" }   // a ONE-OFF thing on a specific date (incl. a one-time stream, collab, appointment, deadline). Resolve relative dates to an absolute date.
- addTask: { text, bucket?: "personal"|"content"|"hobbies"|"health"|"someday", spoon?: "low"|"some"|"full" }
- addContent: { title, format?: "short"|"long"|"twitter", stage?: "idea"|"scripting"|"recording"|"editing"|"thumbnail"|"scheduled"|"published", pillar?: "growth"|"retention"|"experimental" }
- addIncome: { kind: "in"|"out", source, amount:number, category?, note? }
- addScheduleSlot: { day: "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", time?, title? }   // a RECURRING weekly stream day that repeats every week — use the weekday name, NEVER a single date
- setStreamDay: { on: boolean }        // marks TODAY a stream day or not
- logHealth: { field: "pain"|"fatigue"|"fog"|"dizziness"|"lighthead"|"palp"|"anxiety"|"focus"|"mood"|"water"|"salt"|"slips"|"sleepH"|"sleepQ", value:number }
- addSticky: { text }
- addCapture: { text }                  // a quick brain-dump capture
- navigate: { tab: "home"|"content"|"planner"|"calendar"|"optimize"|"habits"|"health"|"care"|"income"|"pitch"|"review" }
- logEmotion: { feelings?: string[] (precise words: "anxious","overwhelmed","frustrated","irritable","angry","sad","low / empty","numb","restless","tense","ashamed","guilty","lonely","content","calm","relieved","happy","excited","proud","hopeful"), intensity?: 0-5, trigger?: string, helped?: string[] (keys: "name","reframe","breathe","opposite","ground","reach","move","sensory","rest") }
- logEF: { init?: 0-5 (0 easy to start → 5 stuck), focus?: 0-5 (0 scattered → 5 locked in), overwhelm?: 0-5 (0 calm → 5 flooded), step?: string (the one tiny next step), supports?: string[] (keys: "broke","twomin","bodydouble","timer","externalize","onething") }
- setEnergy: { level: "low"|"medium"|"high" }     // her spoons today
- markHabit: { name }     // check off a habit by name (fuzzy-matched to her habit list)
- addHabit: { label, emoji?, cat?: "Pre-stream"|"On-air"|"Post-stream"|"Content"|"Community"|"Health"|"Business"|"Batch days", energy?: "essential"|"normal"|"intensive", total?: number }
- scheduleContent: { name (fuzzy-matched to an EXISTING content title in her list above), date: "YYYY-MM-DD" }   // sets that content's scheduled date. Use ONLY for content she already has; if it's a new idea, use addContent instead.
- startScript: { kind: "short"|"long", title?, raw? (any idea/notes/spoken words she gave you to start from), references?, format?: boolean }   // opens the Script Writer seeded with this; set format:true ONLY if she gave enough raw/references to shape it now (otherwise leave false so she can dictate more first).

Stream schedule vs. event — keep these straight:
- "I stream every Tuesday", "add Friday to my stream schedule", "my regular streams are Mon/Wed at 4pm" = RECURRING → addScheduleSlot (weekday, repeats weekly). One slot per weekday she names.
- "schedule a stream this Friday", "I'm streaming on the 14th", "collab stream next Tuesday at 4pm", a one-time/dated stream = a ONE-OFF → addCalendarEvent (a specific date). A dated one-time stream is an EVENT, not a schedule slot.
- If she says "stream" + a weekday with no specific date and it sounds routine → schedule slot. If she says "stream" + a specific/relative date ("this/next Friday", "the 14th", "tomorrow") → calendar event. If genuinely unsure which she means, ask in "reply" instead of guessing.

Rules: only emit actions she clearly asked for. If she's vague, ask in "reply" and emit no actions. Never invent data (amounts, dates) she didn't give — ask instead. You may emit multiple actions in one go (e.g. add an event AND navigate to the calendar).`;
      const raw = await claudeWeb(
        sys,
        `Her recent content (newest first):\n${history}\n\nShe says: "${q}"\n\nReturn ONLY the JSON object.`,
        1400,
      );
      const parsed = parseJSON(raw);
      if (!parsed) return json({ reply: raw, actions: [] });
      if (!Array.isArray(parsed.actions)) parsed.actions = [];
      return json({ reply: parsed.reply || "okay!", actions: parsed.actions });
    }

    // --- script: turn raw spoken notes + research into a formatted short/long-form script ---
    if (mode === "script") {
      const i = body.input || {};
      const kind = i.kind === "long" ? "long" : "short";
      const title = (i.title || "").toString().slice(0, 200);
      const refs = (i.references || "").toString().slice(0, 4000);
      const raw = (i.raw || "").toString().slice(0, 7000);
      if (!raw && !refs) return json({ error: "Add some spoken words or references first." }, 400);
      const common = `Her working title: ${title || "(none)"}\n\nResearch / references she pasted (facts, links, source notes — ground the script in these, don't invent facts):\n${refs || "(none)"}\n\nHer own spoken words (raw voice-to-text — may ramble, mis-punctuate, or repeat; clean it up but KEEP her phrasing, jokes, and voice — do not blandify her):\n${raw || "(none)"}`;
      const prompt = kind === "short"
        ? `Shape this into a tight SHORT-form video script (YouTube Shorts / TikTok, ~45–55 seconds, roughly 110–150 spoken words). Return ONLY JSON:
{ "title": string, "hooks": string[3], "script": string, "cta": string }
- hooks: 3 punchy first-line options (the first 1–2 seconds — curiosity / shock / a specific claim, in her TITLE-ENGINE style).
- script: the full spoken script in her warm, playful, lightly-unhinged, spoon-theory-aware voice. Open on the strongest hook, 2–4 fast beats, one clear payoff. Spoken lines only (no camera directions). Tight enough for a short.
- cta: one soft, on-brand closing line.
${common}`
        : `Shape this into a LONG-form YouTube script. Return ONLY JSON:
{ "title": string, "hooks": string[3], "script": string, "cta": string }
- script: a full script in her voice — a strong cold-open hook, then clear sections using short "## Section name" headers, natural spoken paragraphs grounded in the research, building logically, with a warm outro. Tighten the rambling but preserve her points, phrasing, and personality.
- hooks: 3 cold-open options. cta: a warm subscribe / community CTA.
${common}`;
      const out = await claude(BRAND, prompt, 2400);
      return json(parseJSON(out) || { title, hooks: [], script: out, cta: "" });
    }

    if (mode === "thumbnail") {
      const img = (body.input?.image || "").toString();
      const m = img.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!m) return json({ error: "No image provided." }, 400);
      const key = Deno.env.get("ANTHROPIC_API_KEY");
      if (!key) return json({ error: "ANTHROPIC_API_KEY secret is not set" }, 400);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 900, system: BRAND,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
            { type: "text", text: `Check this YouTube thumbnail for click potential. Title it'll sit next to: "${(body.input?.title || "").toString().slice(0,200)}". Return ONLY JSON: { "score": number, "verdict": string, "strengths": string[], "improvements": string[] }. Judge it like vidIQ's thumbnail checker: does it read at small / mobile size; contrast + a clear focal point; any text legible AND short (≤4 words); is the face/expression clear and emotive; does it pair with the title without just repeating it. Warm, specific, 2-4 items each.` },
          ] }],
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data?.error?.message || "vision error" }, 500);
      const text = (data.content || []).map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
      return json(parseJSON(text) || { verdict: text });
    }

    if (mode === "optimize") {
      const i = body.input || {};
      const footer = (i.footer || "").toString().slice(0, 1500);
      const live = i.kind === "livestream";
      const prompt = live
        ? `Optimize a MULTISTREAM (she goes live on YouTube + Twitch + Twitter/X at once — all for the SAME stream). Return ONLY JSON:
{ "titles": string[], "description": string, "hashtags": string[], "tags": string[], "twitchTitle": string, "twitterTitle": string, "tips": string[] }
- titles: 4 YOUTUBE stream titles in her format → [aesthetic emoji] + [hook/meme] + [GAME] + cue. Curiosity/challenge framing ("If I die I restart", "first playthrough", "24h grind"). Always name the game.
- description: a full YouTube live/VOD description — a 1-2 line hook, what the stream is + her schedule (4 days/wk, 4–6pm EDT), then paste the FOOTER block verbatim near the end.
- hashtags: 2-3 YouTube hashtags (the game + #vtuber).
- tags: 12-15 YouTube tags — the game, "vtuber", "vtuber live", "livestream", her niches (ARPG/MMO/Soulslike).
- twitchTitle: ONE Twitch title → [emoji] [hook/meme] [GAME] [optional !command]; punchy, curiosity/challenge.
- twitterTitle: ONE short X/Twitter broadcast title for the multistream — keyword-rich + a hook, NO hashtags, NO link.
- tips: 2 short reminders, e.g. "start the YouTube stream only once gameplay begins — YT hates mid-stream category switches" and "put a hot-take or question in the title to prime chat before they click".
Stream game / focus: ${(i.topic || i.title || "").toString().slice(0, 800)}
FOOTER (paste verbatim into the description):
${footer}
Her recent titles:
${history}`
        : `Optimize this ${i.format || "long-form"} video for ${i.platform || "YouTube"}. Return ONLY JSON:
{ "titleScore": number, "titleWhy": string, "titles": string[], "tags": string[], "hashtags": string[], "description": string }
- titleScore 0-100; titleWhy 1-2 sentences (use the TITLE ENGINE rubric).
- titles: 4 stronger options using her proven templates.
- tags: 12-15 YouTube SEO tags / keywords, most important first.
- hashtags: 5 following 1 small / 2 medium / 2 large, right for the platform.
- description: a YouTube description — a 1-2 line hook, a short summary, a "⏱ Timestamps:" placeholder line, then paste the FOOTER block verbatim near the end.
Title: ${i.title || "(none)"}
Topic / notes: ${(i.topic || "").toString().slice(0, 1200)}
FOOTER (paste verbatim near the end of the description):
${footer}
Her recent content:
${history}${vidiq}`;
      const raw = await claude(BRAND, prompt, 2000);
      return json(parseJSON(raw) || { titleWhy: raw, titles: [], tags: [], hashtags: [] });
    }

    // mode === "analyze"
    const i = body.input || {};
    const raw = await claude(
      BRAND,
      `Analyze this content idea and return ONLY JSON (no prose around it):
{
  "score": number,          // 0-100 overall click + quality potential
  "criteria": { "relevant": boolean, "nonobvious": boolean, "absorbable": boolean, "actionable": boolean },
  "verdict": string,        // 1-2 warm sentences on where it stands
  "titles": string[],       // 3 stronger title options, in her voice, platform-appropriate
  "hooks": string[],        // 2 opening-line hooks (first 1-2 seconds)
  "hashtags": string[],     // 5 tags following 1 small / 2 medium / 2 large, right for the platform
  "fix": string             // the single highest-leverage improvement
}

Her recent content (learn her patterns):
${history}${vidiq}

The idea to analyze:
title: ${i.title || "(none)"}
format: ${i.format || "(none)"}  platform: ${i.platform || "(none)"}  pillar: ${i.pillar || "(none)"}
hook: ${i.hook || "(none)"}
notes: ${(i.script || "").toString().slice(0, 1000)}`,
      1800,
    );
    const parsed = parseJSON(raw);
    if (!parsed) return json({ score: null, verdict: raw, titles: [], hooks: [], hashtags: [] });
    return json(parsed);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
