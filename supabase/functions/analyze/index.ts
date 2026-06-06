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

// Fallback personality for any non-eggie user (e.g. the desktop pet). Each user's real
// persona lives in THEIR sentinel daily_logs row (log_date 2000-01-01) under
// appConfig.assistantPrompt — editable without redeploying.
const GENERIC_ASSISTANT = `You are a warm, practical desktop companion. You chat, remember things the user tells you, set reminders, and keep small lists. Friendly, a little playful, concise — never preachy, never corporate.`;

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
// Citation markers like <cite index="3-13">…</cite> sometimes leak into the model's
// text when web search is on — strip the tags, keep the words inside them.
function stripCites(s: string): string {
  return String(s == null ? "" : s).replace(/<\/?cite[^>]*>/g, "").replace(/\s{2,}/g, " ").trim();
}

async function claudeWeb(system: string, user: string, maxTokens = 1800, maxSearches = 4): Promise<{ text: string; sources: { url: string; title: string }[] }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret is not set");
  const messages: any[] = [{ role: "user", content: user }];
  let text = "";
  const cited = new Map<string, string>();   // urls the model actually cited
  const found = new Map<string, string>();   // every search result it saw (fallback)
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
    for (const b of (data.content || [])) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r?.url && !found.has(r.url)) found.set(r.url, r.title || "");
      }
      if (b.type === "text" && Array.isArray(b.citations)) {
        for (const c of b.citations) if (c?.url && !cited.has(c.url)) cited.set(c.url, c.title || "");
      }
    }
    text = (data.content || []).map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    // server tools run inside Anthropic; only "pause_turn" needs us to continue the turn
    if (data.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: data.content }); continue; }
    break;
  }
  // up to 5 sources: cited pages first, then other search results
  const sources: { url: string; title: string }[] = [];
  for (const [url, title] of cited) { if (sources.length >= 5) break; sources.push({ url, title }); }
  for (const [url, title] of found) { if (sources.length >= 5) break; if (!cited.has(url)) sources.push({ url, title }); }
  return { text: stripCites(text), sources };
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
    // meds list + which are taken today
    if (s.medsList?.length) {
      const taken = h.meds || {};
      lines.push(`MEDS: ${s.medsList.map((m: any) => `${m.name}${taken[m.id] ? " ✓taken" : ""}`).join(", ")}`);
    }
    // tasks
    const tasks = (s.tasks || s.planner || []).filter((t: any) => t && !t.done).slice(0, 12);
    if (tasks.length) lines.push(`OPEN TASKS: ${tasks.map((t: any) => `${t.text}${t.bucket ? " [" + t.bucket + "]" : ""}${t.due ? " due:" + t.due : ""}`).join("; ")}`);
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
    // art minutes this week
    if (s.artLog?.length) {
      const wkd = new Date(today + "T00:00"); wkd.setDate(wkd.getDate() - ((wkd.getDay() + 6) % 7));
      const wks = wkd.toLocaleDateString("en-CA");
      const am = s.artLog.filter((e: any) => e.date >= wks).reduce((a: number, e: any) => a + Number(e.min || 0), 0);
      lines.push(`ART: ${am} min of art/play this week${s.artChallenge?.dayText ? `; today's challenge: ${s.artChallenge.dayText}${s.artChallenge.dayDone ? " ✓" : ""}` : ""}${s.artChallenge?.weekText ? `; week challenge: ${s.artChallenge.weekText}${s.artChallenge.weekDone ? " ✓" : ""}` : ""}.`);
    }
    if (s.artBoard?.length || s.artResources?.length) lines.push(`ART STUDIO: mood board has ${s.artBoard?.length || 0} card(s); art library has ${s.artResources?.length || 0} saved link(s).`);
    if (s.eugeneFacts?.length) lines.push(`REMEMBERED FACTS (she told you to keep these): ${s.eugeneFacts.slice(-20).join(" | ")}`);
    if (s.reminders?.length) {
      const up = s.reminders.filter((r: any) => !r.done).sort((a: any, b: any) => String(a.date + (a.time || "")).localeCompare(String(b.date + (b.time || "")))).slice(0, 6);
      if (up.length) lines.push(`REMINDERS PENDING: ${up.map((r: any) => `${r.date}${r.time ? " " + r.time : ""} — ${r.text}`).join("; ")}`);
    }
    lines.push(`PUSH DEVICES: ${(s.pushSubs || []).length} subscribed for web-push reminders.`);
    lines.push(`DISCORD DELIVERY: reminder pings go to ${s.discordNotify?.mode === "channel" ? `server channel ${s.discordNotify.channelId}` : "private DMs"}.`);
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

    // --- gameUpdates: web-search upcoming releases/leagues/patches for her games (Eugene-triggered) ---
    if (mode === "gameUpdates") {
      const games = (Array.isArray(body.input?.games) && body.input.games.length ? body.input.games : ["Path of Exile", "Path of Exile 2", "Warhammer 40K: Space Marine 2", "Monster Hunter Wilds", "Resident Evil (series)", "Silent Hill (series)", "Final Fantasy XIV"]).slice(0, 12);
      const td = new Date().toLocaleDateString("en-CA");
      const raw = await claudeWeb(
        "You are a precise gaming-release researcher. Use web search to verify. Return ONLY JSON, no prose around it.",
        `Today is ${td}. For these games/franchises: ${games.join("; ")} — find OFFICIALLY ANNOUNCED upcoming events in the next ~8 months: full releases, expansions, new leagues/seasons, dated major patches, open betas. Month-level dates are fine. No rumors or speculation.
Return ONLY: {"events":[{"date":"YYYY-MM-DD (use the 15th if only a month is known)","title":"Game — what it is","approx":true,"url":"official source"}]}
Max 12 events, future dates only.`,
        1600, 6,
      );
      const parsed = parseJSON(raw);
      return json(parsed && Array.isArray(parsed.events) ? { events: parsed.events } : { events: [] });
    }

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
      const hist = Array.isArray(body.input?.history) ? body.input.history.slice(-10) : [];
      const convo = hist.length
        ? "Recent conversation (oldest first — use it to resolve follow-ups like \"yes\", \"the second one\", \"actually 5pm\"):\n" +
          hist.map((m: any) => ((m.role === "me" ? (userId === "eggie" ? "Her: " : "Them: ") : "You: ")) + String(m.text || "").slice(0, 300)).join("\n") + "\n\n"
        : "";
      const ctx = await fullContext(userId, today);
      // per-user personality: eggie keeps BRAND; anyone else gets the persona stored on
      // THEIR sentinel row (appConfig.assistantPrompt), falling back to GENERIC_ASSISTANT.
      let persona = BRAND;
      let nameLine = "Your name is Eugene — Eggie's cozy octopus helper. If she asks who you are, you're Eugene. 🐙";
      if (userId !== "eggie") {
        persona = GENERIC_ASSISTANT;
        nameLine = "If asked who you are, stay in the persona described at the top of these instructions.";
        try {
          const sbp = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
          const { data: row } = await sbp.from("daily_logs").select("notes")
            .eq("user_id", userId).eq("log_date", "2000-01-01").maybeSingle();
          const p = JSON.parse(row?.notes || "{}")?.appConfig?.assistantPrompt;
          if (p) persona = String(p).slice(0, 4000);
        } catch { /* keep GENERIC_ASSISTANT */ }
      }
      let sys = persona + `

You are also Eggie's hands inside the OS: you can DO things by emitting actions, not just talk. Today (her local date) is ${today}; her calendar timezone is ${tz}. Resolve relative dates ("tomorrow", "next Friday", "in 2 weeks") to absolute YYYY-MM-DD using that.

You can SEE her whole OS. Use this live snapshot to answer questions about ANY part of her data (health, money, tasks, schedule, sponsors, goals, trends) and to make smart choices — never claim you can't see her data:
--- LIVE OS SNAPSHOT ---
${ctx}
--- END SNAPSHOT ---

WEB ACCESS: you have a real web_search tool. Use it (sparingly, only when the answer needs current/outside facts she doesn't have logged) for things like game release/patch dates, trending VTuber hashtags or sounds, news, prices, or "look up X". Do NOT search for things already in the snapshot. After any searching, your FINAL message must still be ONLY the JSON envelope below.

VIDIQ: you do NOT have a direct VidIQ connection from here (VidIQ has no public API the OS can call). Do not pretend to pull live VidIQ data. You CAN still score titles/thumbnails with the built-in "poor-man's vidIQ" rubric above, and for real VidIQ numbers tell her to use the 🎯 Optimize tab or ask in Claude chat. If body.vidiq data was passed to you, you may use it.

${nameLine}

Return ONLY JSON, no prose around it:
{ "reply": string, "actions": [ { "type": string, ...args } ] }
- "reply": one short, warm message in her voice confirming what you did (or just answering, if no action is needed). 🐙 IMPORTANT — write "reply" in PLAIN TEXT and emojis ONLY. Absolutely no asterisks, no markdown, no **bold**/*italics*, no backticks, no #headings, no bullet symbols (-, •, *), no tables, no other special formatting characters. Just warm sentences and emoji. When you searched the web, weave the finding into a normal sentence (you may mention the source name in plain words).
- "actions": the things to perform. Empty array for pure questions/chit-chat.

Allowed action types and their args (use ONLY these; pick valid enum values):
- addCalendarEvent: { title, date:"YYYY-MM-DD", endDate?:"YYYY-MM-DD" (multi-day), time?:"HH:MM" 24h, tz?:IANA zone (default ${tz}), note?, color?:"#hex" }   // a ONE-OFF thing on a specific date (incl. a one-time stream, collab, appointment, deadline). Resolve relative dates to an absolute date.
- addTask: { text, bucket?: "personal"|"content"|"hobbies"|"health"|"someday", spoon?: "low"|"some"|"full", due?: "YYYY-MM-DD" }   // due = soft deadline shown on the task ("by Friday" → resolve it); for an actual PING use setReminder (or both)
- addContent: { title, format?: "short"|"long"|"twitter", stage?: "idea"|"scripting"|"recording"|"editing"|"thumbnail"|"scheduled"|"published", pillar?: "growth"|"retention"|"experimental" }
- addIncome: { kind: "in"|"out", source, amount:number, category?, note? }
- addScheduleSlot: { day: "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", time?, title? }   // a RECURRING weekly stream day that repeats every week — use the weekday name, NEVER a single date
- setStreamDay: { on: boolean }        // marks TODAY a stream day or not
- logHealth: { field: "pain"|"fatigue"|"fog"|"dizziness"|"lighthead"|"palp"|"anxiety"|"focus"|"mood"|"water"|"salt"|"slips"|"sleepH"|"sleepQ", value:number }
- addSticky: { text }
- addCapture: { text }                  // a quick brain-dump capture
- navigate: { tab: "home"|"content"|"planner"|"calendar"|"optimize"|"habits"|"health"|"care"|"art"|"income"|"pitch"|"review"|"eugene"|"settings" }
- logEmotion: { feelings?: string[] (precise words: "anxious","overwhelmed","frustrated","irritable","angry","sad","low / empty","numb","restless","tense","ashamed","guilty","lonely","content","calm","relieved","happy","excited","proud","hopeful"), intensity?: 0-5, trigger?: string, helped?: string[] (keys: "name","reframe","breathe","opposite","ground","reach","move","sensory","rest") }
- logEF: { init?: 0-5 (0 easy to start → 5 stuck), focus?: 0-5 (0 scattered → 5 locked in), overwhelm?: 0-5 (0 calm → 5 flooded), step?: string (the one tiny next step), supports?: string[] (keys: "broke","twomin","bodydouble","timer","externalize","onething") }
- setEnergy: { level: "low"|"medium"|"high" }     // her spoons today
- markHabit: { name }     // check off a habit by name (fuzzy-matched to her habit list)
- addHabit: { label, emoji?, cat?: "Pre-stream"|"On-air"|"Post-stream"|"Content"|"Community"|"Health"|"Business"|"Batch days", energy?: "essential"|"normal"|"intensive", total?: number }
- scheduleContent: { name (fuzzy-matched to an EXISTING content title in her list above), date: "YYYY-MM-DD" }   // sets that content's scheduled date. Use ONLY for content she already has; if it's a new idea, use addContent instead.
- startScript: { kind: "short"|"long", title?, raw? (any idea/notes/spoken words she gave you to start from), references?, format?: boolean }   // opens the Script Writer seeded with this; set format:true ONLY if she gave enough raw/references to shape it now (otherwise leave false so she can dictate more first).
- markMed: { name (fuzzy-matched to a med on her list), on?: boolean (default true) }   // "I took my <med>", "mark off my meds", "check off my morning pill"
- markAllMeds: { on?: boolean }     // "I took all my meds today"
- addMed: { name, dose?, time? }    // add a new medication to her list
- completeTask: { name (fuzzy-matched to a planner task), done?: boolean }   // "mark <task> done", "I finished <task>", "uncheck <task>". Linked task↔reminder pairs complete TOGETHER automatically (same for doneReminder) — never emit both actions for one thing.
- moveTask: { name, status: "todo"|"doing"|"done" }   // move a task on the kanban board
- delTask: { name }                 // remove a planner task she names
- addGoal: { scope: "week"|"month", text }     // add a goal to her week or month goals
- checkGoal: { scope: "week"|"month", name, done?: boolean }   // tick/untick one of her goals
- setCreative: { project?, step? }  // her gentle creative focus — what she's playing with + the next tiny step
- addJoy: { text }                  // add an item to her joy jar
- careToggle: { joy?: boolean, skill?: boolean, mood?: 1-5 }   // "I did something for me today" (joy), "I used a skill" (skill), weather-inside mood 1(🌧️)-5(🌞)
- logHealth: also accepts counters (water, salt, slips — set the new running total) and these boolean flags via setHealthFlag below
- setHealthFlag: { field: "compression"|"legsup"|"bracing"|"movement"|"paced", on?: boolean }   // POTS/EDS care checkboxes for today
- setJoint: { joint: "jaw"|"shoulders"|"wrists"|"fingers"|"hips"|"knees"|"ankles"|"spine", on?: boolean }   // note an achy/unstable joint today
- setFlare: { on?: boolean }        // "I'm in a flare today"
- addSavingsGoal: { name, target?: number, emoji? }
- allotSavings: { name (fuzzy-matched to a savings goal), amount: number }   // "put $20 toward <goal>"
- addSponsor: { brand, stage?: "dream"|"draft"|"sent"|"responded"|"signed"|"passed", deal_type?, value?: number, note? }   // "dream" = wishlist brands she hopes to work with someday
- moveSponsor: { brand, stage: "dream"|"draft"|"sent"|"responded"|"signed"|"passed" }
- setSponsor: { brand (fuzzy), stage?, deal_type?, value?: number, contact?, links?, follow_up?: "YYYY-MM-DD", note? }   // edit sponsor details; follow_up shows nudge pills on the pipeline
- delSponsor: { brand (fuzzy) }
- moveContent: { name (fuzzy-matched to existing content), stage: "idea"|"scripting"|"recording"|"editing"|"thumbnail"|"scheduled"|"published" }   // move a piece of content along its pipeline
- setReview: { field: "wins"|"slipped"|"loops"|"followups"|"notes"|"spoons"|"top3", text }   // jot into this week's review
- recoveryDay: { }                  // set today as a gentle recovery day (low energy, not a stream day)
- refreshGameUpdates: { }           // "check for game updates", "refresh the games calendar" — web-searches official upcoming releases/leagues/patches for her games and updates the calendar's 🎮 layer (slow-ish: ~20s; tell her you're on it)
- logArt: { minutes: number, note? }   // "I drew for 30 minutes", "log 20 min of art" — celebrate it, art is just-for-her and counts
- artChallengeDone: { scope: "day"|"week", done?: boolean }   // tick her daily or weekly art challenge
- addBoardNote: { text }              // pin a note card to her art mood board
- addBoardImage: { url }              // add an image BY URL to the mood board (she uploads local files herself)
- addBoardColor: { color?: "#hex" }   // drop a colour swatch onto the mood board
- addArtResource: { title, url, tag?: "reference"|"colour"|"perspective"|"learn"|"other" }   // save a tutorial / tool link to her art library
- addArtIdea: { text }                // "add to my ideas dump: …" — park an art idea so it doesn't get lost
- addInspo: { url, note? }            // "save this to my inspiration vault" — a trending post / art style / ref she wants to try
- rollArtPrompt: { }                  // "give me something to draw" — rolls a fresh OC/anime draw-this prompt and opens the Art tab
- startArtTimer: { seconds? }         // "start an art timer", "let's warm up" — starts her gesture-practice timer (default 120s rounds)
- showGuide: { type: "thirds"|"phi"|"spiral"|"armature"|"radial"|"iso"|"persp1"|"persp2"|"persp3" }   // open a composition guide — golden spiral, phi grid, dynamic symmetry, radial, isometric, 1/2/3-pt perspective
- delCalendarEvent: { title (fuzzy), date?: "YYYY-MM-DD" }   // "cancel/delete the dentist appointment" — date narrows it if she gives one
- moveCalendarEvent: { title (fuzzy), date: "YYYY-MM-DD" }   // "move the collab to next Friday" (multi-day events keep their length)
- delScheduleSlot: { day: "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun" }   // "remove Tuesday from my stream schedule"
- delContent: { name (fuzzy) }       // delete a piece of content from the pipeline — confirm in reply if her phrasing was vague
- setContentDeadline: { name (fuzzy), date: "YYYY-MM-DD" }   // set/change a content brief's deadline
- addSubtask: { task (fuzzy), text }  // break a planner task into a small step
- setTask: { name (fuzzy — matches the CURRENT wording), text? (the new wording — rename), bucket?: "personal"|"content"|"hobbies"|"health"|"someday", spoon?: "low"|"some"|"full", due?: "YYYY-MM-DD" or "" to clear }   // edit a task: rename, re-bucket, change spoons, set/clear due. Renaming also renames its linked reminder.
- delHabit: { name (fuzzy) }          // remove a habit from her library
- delMed: { name (fuzzy) }            // remove a medication from her list
- delLastIncome: { }                  // "undo that last money entry" — removes the most recent ledger entry only (safest)
- delSavingsGoal: { name (fuzzy) }
- delJoy: { text (fuzzy) }            // take something out of the joy jar
- delGoal: { scope: "week"|"month", name (fuzzy) }   // remove a week/month goal entirely (checkGoal just ticks it)
- setHealthNote: { note?, triggers? } // free-text note / suspected triggers on today's health log
- setTaxRate: { percent: 0-90 }       // her money set-aside rate
- setSetAside: { amount: number }     // how much she's set aside this month
- loadScript: { title (fuzzy) }       // open a saved script draft in the Script Writer
- delBoardCard: { text }              // remove a mood-board NOTE matching the text, or a SWATCH by exact "#hex"
- delSticky: { text (fuzzy) }         // peel a sticky note off the screen

- setReminder: { text?, task? (fuzzy name of an EXISTING planner task), date: "YYYY-MM-DD", time?: "HH:MM" 24h (default "09:00"), email?: boolean (default true) }   // "remind me Friday at 3 to send the invoice", "remind me in 2 hours to stretch" — resolve relative dates/times to absolute using today + her timezone. If she's clearly talking about an existing task ("remind me about the thumbnail task tomorrow"), pass the 'task' arg — the reminder LINKS to it: one thing, one ping, and completing either finishes both. A linked task already having a reminder just updates its time. Reminders are a real struggle for her — set them generously whenever she even hints at one.
- delReminder: { text (fuzzy) }       // cancel a reminder
- doneReminder: { text (fuzzy) }      // mark a reminder handled
- rememberFact: { fact }              // "remember that my editor is Sam", "remember I hate Mondays for collabs" — store any standing fact/preference she tells you to keep
- forgetFact: { hint }                // remove a remembered fact matching the hint
- optimizeTitle: { title, topic?, format?: "short"|"long", platform? }   // "score/optimize this title: …" — runs her real optimizer and returns the score + better titles in chat
- setDiscordDelivery: { mode: "dm"|"channel", channelId? (numeric, required for channel) }   // "send my Discord pings to #reminders" / "DM me instead" — where reminder pings go on Discord

DELETES: deleting is destructive — if her wording is ambiguous about WHICH item (multiple could match), ask in "reply" and emit no actions instead of guessing. When she then confirms ("yes", "the first one"), use the conversation context and emit the action. "Undo" for money = delLastIncome.

MEMORY: you receive the recent conversation AND her remembered facts — use both naturally. If she tells you something worth keeping ("my capture card is a 4K60", "collabs always at 4pm ET"), offer to remember it or just rememberFact when she clearly asks.

HOW HER REMINDERS REACH HER (know this system; answer questions about it accurately):
- In-tab ping: while the OS is open, due reminders toast + bubble within ~30 seconds.
- Web push 📲: real notifications on subscribed devices even with the browser closed, delivered by a cron that runs every ~5 minutes (so timing is ±5 min). A device subscribes once via Settings → "push to this device" (or the Planner). Once a device has granted permission, the OS re-subscribes it automatically on every load — she never has to think about it again. iPhone only supports this if the OS is added to the Home Screen first (Apple's rule); Android Chrome and desktop work directly.
- Email 💌: due reminders also email her (default ON per reminder; email:false turns it off — email sends ONCE, no repeats).
- RE-PINGING (by design, kindly): until a due reminder is marked done or snoozed, push + Discord re-nudge every ~30 minutes, up to 4 waves total ("🔁 nudge 2/4 …"), then it rests but stays visible on the Planner. ✓ done or 😴 snooze stops the nudging; snooze restarts the cycle at the new time. If she says it's nagging too much: mark it done, snooze it, or delete it.
- Discord 💬: due reminders ALSO arrive on Discord with ✓ done / 😴 snooze-1h buttons — by default as a private DM from the bot (which pings her phone via the Discord app), or, if she prefers, posted into ONE server channel she picks (the bot @mentions her there so the phone still buzzes). She switches DM ↔ channel in Settings → Notifications, or just by telling you — use setDiscordDelivery. If a chosen channel ever fails (deleted / no permission), delivery auto-falls back to DMs so pings never silently die.
The snapshot tells you how many devices are subscribed. If she says reminders aren't reaching her phone, walk her through: is the device subscribed (Settings → 📲)? on iPhone, is it installed to the Home Screen? are notifications allowed for the browser in system settings? Is Discord delivery set to a channel she's muted?

YOU ARE ALSO ON DISCORD (know your own integration):
- You exist as a Discord bot in her server (and via user-install, anywhere she goes). Slash commands: /ask (this same brain), /remind, /task, /capture, /idea, /inspo, /today (her day at a glance), /done. Everything written from Discord lands in the same OS database.
- You CANNOT read normal Discord chat or react to casual @mentions in conversation — serverless bots only hear slash commands and button presses (that's a hard platform limit, not shyness). If she asks why you didn't respond in chat, that's why: tell her to use /ask.
- Reminder pings on Discord carry working ✓ done and 😴 snooze buttons.
- Her boyfriend (or anyone) can be added by mapping their Discord id to their own OS user tag — their commands then hit THEIR data, never hers.

When she mentions art, drawing, doodling, or creative play, be warm and encouraging — art is restorative for her and she struggles to give herself permission, so affirm that making time for it is a win (never imply she should be doing something "more productive"). If she's drained or pushing too hard, you can gently suggest an art break.

You can control essentially every part of her OS with the actions above — meds, health, POTS/joint care, tasks and the kanban, habits, goals, content pipeline, calendar, stream schedule, money, savings, sponsors, care/emotion check-ins, creative focus, joy jar, scripts, the weekly review, AND the whole art studio (draw-this prompts, the practice timer, composition guides, the mood board, the resource library, art minutes and challenges). If she asks for something and a matching action exists, DO it; only fall back to a plain reply when nothing fits or you're missing a detail.

Stream schedule vs. event — keep these straight:
- "I stream every Tuesday", "add Friday to my stream schedule", "my regular streams are Mon/Wed at 4pm" = RECURRING → addScheduleSlot (weekday, repeats weekly). One slot per weekday she names.
- "schedule a stream this Friday", "I'm streaming on the 14th", "collab stream next Tuesday at 4pm", a one-time/dated stream = a ONE-OFF → addCalendarEvent (a specific date). A dated one-time stream is an EVENT, not a schedule slot.
- If she says "stream" + a weekday with no specific date and it sounds routine → schedule slot. If she says "stream" + a specific/relative date ("this/next Friday", "the 14th", "tomorrow") → calendar event. If genuinely unsure which she means, ask in "reply" instead of guessing.

Rules: only emit actions she clearly asked for. If she's vague, ask in "reply" and emit no actions. Never invent data (amounts, dates) she didn't give — ask instead. You may emit multiple actions in one go (e.g. add an event AND navigate to the calendar).`;
      // non-eggie users: de-Eggify the shared instruction text (their persona is already in `sys`)
      if (userId !== "eggie") {
        sys = sys
          .replace(/Eggie's hands inside the OS/g, "the user's hands inside their assistant")
          .replace(/\bEggie\b/g, "the user")
          .replace(/\bHer\b/g, "Their").replace(/\bher\b/g, "their")
          .replace(/\bShe\b/g, "They").replace(/\bshe\b/g, "they");
      }
      const userMsg = userId === "eggie"
        ? `${convo}Her recent content (newest first):\n${history}\n\nShe says: "${q}"\n\nReturn ONLY the JSON object.`
        : `${convo}They say: "${q}"\n\nReturn ONLY the JSON object.`;
      const { text: raw, sources } = await claudeWeb(sys, userMsg, 1400);
      const parsed = parseJSON(raw);
      if (!parsed) return json({ reply: stripCites(raw), actions: [], sources });
      if (!Array.isArray(parsed.actions)) parsed.actions = [];
      return json({ reply: stripCites(parsed.reply || "okay!"), actions: parsed.actions, sources });
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
