// =============================================================================
// Eggie OS — "analyze" Edge Function 🐙
// The AI brain for the dashboard. Runs inside your Supabase project, holds your
// secret keys, and reads your own content to learn your patterns.
//
// Modes: analyze · agent (Eugene — cached prompt, structured outputs, adaptive thinking, model picker) ·
//        memorize (background long-term memory: summary/loops/episodes/facts — Haiku) ·
//        goblin (breakdown/tone/rephrase/compile/estimate — Haiku) · optimize (video + livestream) ·
//        script · email · thumbnail (vision) · channelStats · channelSnapshot · gameUpdates
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
// Cheap+fast model for micro-tools (goblin) and background memory consolidation — ~3x cheaper than Sonnet.
const MODEL_LIGHT = Deno.env.get("ANTHROPIC_MODEL_LIGHT") || "claude-haiku-4-5";
// Models she may pick for Eugene in Settings (validated server-side; anything else falls back to MODEL).
const AGENT_MODELS = ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5", "claude-fable-5"];
const supportsAdaptive = (m: string) => !m.includes("haiku") && !m.includes("fable");   // fable: always-on thinking, don't send the field
// Guaranteed-parseable {reply, actions[]} via structured outputs (constrained decoding).
// If the API ever rejects it (e.g. combined with web-search citations), we flip this flag and fall back to prompt-JSON.
let SCHEMA_OK = true;
const AGENT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: { type: "array", items: { type: "object", properties: { type: { type: "string" } }, required: ["type"], additionalProperties: true } },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
};

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
Her voice: warm, playful, a little unhinged/self-deprecating, squid/🐙 energy, kind underneath. Match that — aim for the 90+ bar she already hits.

=== VTUBER GROWTH PLAYBOOK (current 2026 best practices — apply whenever you advise on growth, optimize content, or plan; always inside her sustainable spoon-theory pace, never as hustle pressure) ===
DISCOVERY: Livestreaming deepens existing fans but barely reaches NEW people. New-viewer discovery for VTubers comes from CLIPS + short-form (YouTube Shorts, TikTok, Reels), search-friendly long-form, collabs, and community loops. Short-form is not optional — most momentum happens OFF-stream. Treat every stream as raw material: pull 2–4 clippable moments.
YOUTUBE: the algorithm rewards click-through rate, retention, and satisfaction. Shorts are the front door (enormous daily reach, algorithm-pushed) — use them as cheap hook tests; when a Short loops well and converts even a few subs, expand it into a long video plus a playlist. Build THEMED SERIES (5–7 videos on one topic) so the algorithm learns the niche and viewers binge. Niche clarity beats random uploads.
THUMBNAILS: big clean text (3–4 words MAX), one emotive face/expression, high contrast, a single clear subject, curiosity, no clutter — the single biggest CTR lever.
TITLES: topic + promise + curiosity; specific beats vague (use the TITLE ENGINE above).
SHORT-FORM HOOKS: the first ~3 seconds decide everything; viewers scroll in under 3s and the algorithm weights watch-time and completion rate. Lead with a concrete promise of value (specific value beats pure curiosity-bait). Best completion around 15–45s.
CADENCE (sustainable, spoon-aware): short-form 3–7 posts/week is realistic and plenty (1–3/day max; 5+/day risks spam-throttling). Streaming roughly 3x/week, about 3 hours, on consistent days trains both the algorithm and the audience — hardcore fans literally plan their week around her schedule. Consistency of name, vibe, visuals and hook matters more than raw hours.
TWITCH: consistency trains the algorithm but does NOT solve discovery on its own. Pick smaller, less-saturated game categories (rough target 500–5,000 total viewers, e.g. via SullyGnome) so she isn't buried; high-ratio/low-saturation niches reach Affiliate about 3x faster. Affiliate = within a rolling 30 days: 50 followers, 500 stream minutes, 7 unique broadcast days, and an average of 3+ concurrent viewers.
CROSS-PLATFORM: exposure matters more than total stream hours. Repurpose ONE idea across YouTube, Shorts, TikTok and X, keeping a recognizable identity everywhere.
VTUBER-SPECIFIC: lore and a character backstory turn ordinary content into an ongoing saga fans follow; collabs with ADJACENT audiences (overlapping but not identical) are the fastest route to new viewers; show up in community spaces (Discord, subreddits, hashtags); a strong debut plus a consistent early schedule validates the persona. Reaction, compilation, and out-of-context clip formats trend well for VTubers. Search demand for "vtuber" is largest in Japan (~39%), then the US (~11%) and Brazil (~8%); related opportunity terms include vtuber clips, vtuber edit, and envtuber.`;

// Fallback personality for any non-eggie user (e.g. the desktop pet). Each user's real
// persona lives in THEIR sentinel daily_logs row (log_date 2000-01-01) under
// appConfig.assistantPrompt — editable without redeploying.
const GENERIC_ASSISTANT = `You are a warm, practical desktop companion. You chat, remember things the user tells you, set reminders, and keep small lists. Friendly, a little playful, concise — never preachy, never corporate.`;

async function claude(system: string, user: string, maxTokens = 1600, model = MODEL): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
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

// `user` may be a plain string OR an Anthropic content array (e.g. [image, text] for vision).
// `system` may be a plain string OR a system-block array — the agent passes
// [static-with-cache_control, dynamic] so the big unchanging prompt is cached (≈90% cheaper reads).
// opts: { model } pick a model · { effort } adaptive-thinking effort · { jsonSchema } structured outputs.
async function claudeWeb(system: string | any[], user: string | any[], maxTokens = 1800, maxSearches = 4, opts: { model?: string; effort?: string; jsonSchema?: any } = {}): Promise<{ text: string; sources: { url: string; title: string }[]; refusal?: boolean }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret is not set");
  const model = opts.model || MODEL;
  const messages: any[] = [{ role: "user", content: user }];
  let text = "";
  let refusal = false;
  let useSchema = SCHEMA_OK && !!opts.jsonSchema;
  const cited = new Map<string, string>();   // urls the model actually cited
  const found = new Map<string, string>();   // every search result it saw (fallback)
  for (let hop = 0; hop < 5; hop++) {
    const body: any = {
      model, max_tokens: maxTokens, system, messages,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
    };
    // adaptive thinking: the model decides when/how hard to think (Sonnet 4.6 / Opus 4.8;
    // Haiku doesn't support it, Fable thinks on its own without the field)
    if (supportsAdaptive(model)) body.thinking = { type: "adaptive" };
    if (!model.includes("haiku")) body.output_config = { effort: opts.effort || "medium" };
    if (useSchema) body.output_config = { ...(body.output_config || {}), format: { type: "json_schema", schema: opts.jsonSchema } };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      // structured outputs can conflict with citation-bearing tools on some API versions —
      // if that's what broke, drop the schema for this isolate's lifetime and retry once
      const msg = String(data?.error?.message || "");
      if (useSchema && res.status === 400 && /output_config|format|citation|structured/i.test(msg)) { SCHEMA_OK = false; useSchema = false; continue; }
      throw new Error(msg || `Anthropic error ${res.status}`);
    }
    for (const b of (data.content || [])) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r?.url && !found.has(r.url)) found.set(r.url, r.title || "");
      }
      if (b.type === "text" && Array.isArray(b.citations)) {
        for (const c of b.citations) if (c?.url && !cited.has(c.url)) cited.set(c.url, c.title || "");
      }
    }
    text = (data.content || []).map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    if (data.stop_reason === "refusal") { refusal = true; break; }   // Fable-class models decline via stop_reason
    // server tools run inside Anthropic; only "pause_turn" needs us to continue the turn
    if (data.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: data.content }); continue; }
    break;
  }
  // up to 5 sources: cited pages first, then other search results
  const sources: { url: string; title: string }[] = [];
  for (const [url, title] of cited) { if (sources.length >= 5) break; sources.push({ url, title }); }
  for (const [url, title] of found) { if (sources.length >= 5) break; if (!cited.has(url)) sources.push({ url, title }); }
  return { text: stripCites(text), sources, refusal };
}

// Pull a compact snapshot of her ENTIRE OS so the pet can answer about (and act on)
// any part of it: today's health/care/energy, tasks, schedule, goals, money, sponsors,
// savings, and recent health/care trends. Kept short to stay token-cheap.
async function fullContext(userId: string, today: string): Promise<string> {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const parse = (n: any) => { try { return typeof n === "string" ? JSON.parse(n) : (n || {}); } catch { return {}; } };
    const [todayRow, sentRow, recentRows, income, sponsors, savings, content, captures] = await Promise.all([
      sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", today).maybeSingle(),
      sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", "2000-01-01").maybeSingle(),
      sb.from("daily_logs").select("log_date,notes").eq("user_id", userId).neq("log_date", "2000-01-01").order("log_date", { ascending: false }).limit(14),
      sb.from("income_entries").select("kind,source,category,amount,month,note").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
      sb.from("sponsors").select("brand,stage,deal_type,value").eq("user_id", userId).limit(40),
      sb.from("savings_goals").select("name,saved,target").eq("user_id", userId).limit(20),
      sb.from("content_items").select("title,stage,format,priority,parent_id,scheduled_for,published_at,pillar").eq("user_id", userId).limit(200),
      sb.from("raw_captures").select("raw_text,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    ]);
    const d = parse(todayRow?.data?.notes), s = parse(sentRow?.data?.notes);
    const lines: string[] = [];
    // today
    const h = d.health || {}, c = d.care || {};
    const hbits = d.habits?.counts ? Object.values(d.habits.counts).filter((v: any) => v).length : 0;
    lines.push(`TODAY (${today}): energy=${d.energy || "?"}${d.streamDay ? ", STREAM DAY" : ""}; habits done=${hbits}.`);
    if (Object.keys(h).length) lines.push(`  health today: ${Object.entries(h).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    if (Object.keys(c).length) lines.push(`  care today: ${[c.feelings?.length ? "feelings:" + c.feelings.join("/") : "", c.mood != null ? "weather:" + c.mood + "/5" : "", c.bip?.elev != null ? "mood-chart elevation:" + c.bip.elev + (c.bip.irrit ? " irrit:" + c.bip.irrit : "") : "", c.va?.text ? "good-thing:" + c.va.text + (c.va.done ? " ✓" : "") : "", c.rhythm ? "anchors:" + Object.entries(c.rhythm).map(([k, v]) => k + "@" + v).join(" ") : "", c.signs?.length ? "⚠ warning-signs ticked:" + c.signs.length : "", c.efStep ? "next-step:" + c.efStep : ""].filter(Boolean).join(", ")}`);
    if (d.hygiene && Object.keys(d.hygiene).length) lines.push(`  care menu today: ${Object.entries(d.hygiene).map(([k, v]) => `${k}:${v}`).join(", ")} (every tier counts equally)`);
    // meds list + which are taken today
    if (s.medsList?.length) {
      const taken = h.meds || {};
      lines.push(`MEDS: ${s.medsList.map((m: any) => `${m.name}${taken[m.id] ? " ✓taken" : ""}`).join(", ")}`);
    }
    // habits library + which are done today
    if (s.habitsLib?.length) {
      const _hc = d.habits?.counts || {};
      lines.push(`HABITS (${s.habitsLib.length} in library, ✓ = done today): ${s.habitsLib.slice(0, 22).map((hb: any) => `${hb.label || hb.id}${(_hc[hb.id] || 0) >= (hb.total || 1) ? " ✓" : ""}`).join(", ")}.`);
    }
    // tasks
    const tasks = (s.tasks || s.planner || []).filter((t: any) => t && !t.done).slice(0, 12);
    if (tasks.length) lines.push(`OPEN TASKS (☀=she starred it for today; ~Xm=magic estimate): ${tasks.map((t: any) => `${t.today === today ? "☀" : ""}${t.text}${t.bucket ? " [" + t.bucket + "]" : ""}${t.spoon ? " {" + t.spoon + "-spoon}" : ""}${t.due ? " due:" + t.due : ""}${t.est ? " ~" + t.est + "m" : ""}`).join("; ")}`);
    // schedule (per-week: this week's plan from schedWeeks, legacy `schedule` as fallback) + goals
    const _mon = new Date(today + "T00:00"); _mon.setDate(_mon.getDate() - ((_mon.getDay() + 6) % 7)); const _monISO = _mon.toLocaleDateString("en-CA");
    const wkSched = (s.schedWeeks && s.schedWeeks[_monISO]) ? s.schedWeeks[_monISO] : (s.schedule || []);
    if (wkSched.length) lines.push(`STREAM SCHEDULE (this week): ${wkSched.map((x: any) => `${x.day}${x.time ? " " + x.time : ""}${x.title ? " " + x.title : ""}`).join(", ")}.`);
    if (s.goals_week_items?.length) lines.push(`WEEK GOALS: ${s.goals_week_items.map((g: any) => `${g.text || g}${g.done ? " ✓" : ""}`).join("; ")}`);
    if (s.goals_month_items?.length) lines.push(`MONTH GOALS: ${s.goals_month_items.map((g: any) => `${g.text || g}${g.done ? " ✓" : ""}`).join("; ")}`);
    if (s.contentMacros) lines.push(`HER SIMPLE-MODE COLUMN NAMES (use these words): 🌱 ${s.contentMacros.brew || "Brewing"} · 🛠 ${s.contentMacros.make || "Making"} · ✅ ${s.contentMacros.out || "Out"}.`);
    // CONTENT PIPELINE (her videos/shorts/posts)
    if (content?.data?.length) {
      const _items = content.data.filter((c: any) => !c.parent_id);
      const _byStage: Record<string, number> = {}; _items.forEach((c: any) => { _byStage[c.stage] = (_byStage[c.stage] || 0) + 1; });
      const _flight = _items.filter((c: any) => c.stage !== "published").sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0)).slice(0, 8);
      const _since7 = (() => { const d = new Date(today + "T00:00"); d.setDate(d.getDate() - 7); return d.toLocaleDateString("en-CA"); })();
      const _pub7 = _items.filter((c: any) => c.published_at && String(c.published_at).slice(0, 10) >= _since7).length;
      lines.push(`CONTENT PIPELINE: ${_items.length} items — ${Object.entries(_byStage).map(([k, v]) => `${v} ${k}`).join(", ")}. In flight: ${_flight.map((c: any) => `"${c.title}"${c.format ? " (" + c.format + ")" : ""}${c.pillar ? " {" + c.pillar + "}" : ""} [${c.stage}]`).join("; ") || "none"}. Published last 7 days: ${_pub7}.`);
      const _sched = _items.filter((c: any) => c.scheduled_for && c.scheduled_for >= today).sort((a: any, b: any) => a.scheduled_for.localeCompare(b.scheduled_for)).slice(0, 6);
      if (_sched.length) lines.push(`SCHEDULED CONTENT: ${_sched.map((c: any) => `${c.scheduled_for}: ${c.title}`).join("; ")}.`);
    }
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
    // 🧠 long-term memory: rolling summary + open loops + recent episode digests (built by the memorize mode)
    if (s.eugeneMemory?.summary) lines.push(`YOUR MEMORY (rolling summary of what matters lately — auto-updated, she can edit it in the 🧠 panel): ${String(s.eugeneMemory.summary).slice(0, 1900)}`);
    if (s.eugeneMemory?.openLoops?.length) lines.push(`OPEN LOOPS (threads left hanging from past chats — gently offer ONE when relevant, never a list): ${s.eugeneMemory.openLoops.slice(0, 6).map((l: any) => String(l).slice(0, 120)).join(" | ")}`);
    if (s.eugeneEpisodes?.length) lines.push(`RECENT CONVERSATIONS (episode digests, newest last): ${s.eugeneEpisodes.slice(-3).map((e: any) => `${e.date}: ${(e.topics || []).join(", ")}${e.decisions ? " → " + String(e.decisions).slice(0, 100) : ""}`).join(" | ")}`);
    if (s.eugeneFacts?.length) lines.push(`REMEMBERED FACTS (durable things to keep using): ${s.eugeneFacts.slice(-30).map((f: any) => typeof f === "string" ? f : `${f.text}${f.source === "auto" ? "" : " (she told you)"}`).join(" | ")}`);
    if (s.osChangeRequests?.length) {
      const open = s.osChangeRequests.filter((r: any) => r.status !== "done");
      lines.push(`OS CHANGE REQUESTS (the 🛠️ wishlist of app changes you logged for Claude the developer; don't re-log duplicates): ${open.length} open${open.length ? " — " + open.slice(-8).map((r: any) => `"${r.title}"${r.area ? " [" + r.area + "]" : ""} (${r.date || "?"})`).join("; ") : ""}; ${s.osChangeRequests.length - open.length} done.`);
    }
    if (s.reminders?.length) {
      const up = s.reminders.filter((r: any) => !r.done).sort((a: any, b: any) => String(a.date + (a.time || "")).localeCompare(String(b.date + (b.time || "")))).slice(0, 6);
      if (up.length) lines.push(`REMINDERS PENDING: ${up.map((r: any) => `${r.date}${r.time ? " " + r.time : ""} — ${r.text}`).join("; ")}`);
    }
    lines.push(`PUSH DEVICES: ${(s.pushSubs || []).length} subscribed for web-push reminders.`);
    lines.push(`DISCORD DELIVERY: reminder pings go to ${s.discordNotify?.mode === "channel" ? `server channel ${s.discordNotify.channelId}` : "private DMs"}.`);
    if (s.clients?.length) {
      const att = s.clients.filter((c: any) => c.status !== "offboarded" && (c.tasks || []).some((t: any) => !t.done && t.status !== "done"));
      lines.push(`SAKURA LIGHTWORKS (her mgmt clients): ${s.clients.length} total. Needing attention: ${att.length ? att.map((c: any) => { const open = (c.tasks || []).filter((t: any) => !t.done && t.status !== "done"); const od = open.filter((t: any) => t.due && t.due < today).length; return `${c.name} (${open.length} open${od ? ", " + od + " OVERDUE" : ""}: ${open.slice(0, 2).map((t: any) => t.text).join("; ")})`; }).join(" | ") : "none — all caught up"}.`);
      // FULL live profiles so Eugene always reflects whatever she just entered (notes, brand brain,
      // deliverables, goals, due dates, contact, etc.) — read fresh from the DB on every message.
      const fld = (label: string, v: any) => v ? ` ${label}=${String(v).slice(0, 160)}` : "";
      s.clients.slice(0, 14).forEach((c: any) => {
        const open = (c.tasks || []).filter((t: any) => !t.done && t.status !== "done");
        const needs = open.length ? open.map((t: any) => `${t.text}${t.due ? " (due " + t.due + (t.due < today ? " OVERDUE" : "") + ")" : ""}${t.status && t.status !== "needs" ? " [" + t.status + "]" : ""}`).join("; ") : "none open";
        const notes = (c.notes || []).slice(-3).map((n: any) => `${n.date ? n.date + ": " : ""}${String(n.text || "").slice(0, 140)}`).join(" | ");
        const plats = (c.platforms || []).map((p: any) => p.label || p.url).filter(Boolean).slice(0, 4).join(", ");
        lines.push(`  • CLIENT ${c.name}${c.pronouns ? " (" + c.pronouns + ")" : ""} — status=${c.status || "?"}${fld("priority", c.priority)}${fld("tz", c.tz)}${fld("role", c.tier)}${fld("handle", c.handle)}${fld("contact", c.contact)}${fld("discord", c.discord)}${fld("niche", c.niche)}${fld("voice", c.brain)}${fld("winningStyle", c.style)}${fld("deliverables", c.deliverables)}${fld("goals", c.goals)}${fld("prefs", c.prefs)}${plats ? " platforms=" + plats : ""}${c.discordChannel ? " (Discord channel linked)" : ""}. NEEDS: ${needs}.${notes ? " RECENT NOTES: " + notes + "." : ""}`);
      });
    }
    const unread = (s.inbox || []).filter((m: any) => !m.read);
    if (unread.length) lines.push(`INBOX: ${unread.length} unread from clients — ${unread.slice(-4).map((m: any) => `${m.from || "?"}: ${String(m.text || "").slice(0, 60)}`).join(" | ")}`);
    if (savings?.data?.length) lines.push(`SAVINGS GOALS: ${savings.data.map((g: any) => `${g.name} $${g.saved}/${g.target || "?"}`).join(", ")}`);
    if (s.invoices?.length) {
      const _out = s.invoices.filter((i: any) => i.status !== "paid"); const _paid = s.invoices.filter((i: any) => i.status === "paid");
      const _owed = _out.reduce((a: number, i: any) => a + Number(i.amount || 0), 0);
      lines.push(`INVOICES: ${_out.length} outstanding ($${_owed})${_out.length ? ": " + _out.map((i: any) => `${i.client || "?"} $${i.amount || 0}${i.due ? " due " + i.due + (i.due < today ? " OVERDUE" : "") : ""}`).join("; ") : ""}; ${_paid.length} paid.`);
    }
    if (s.taxRate || s.setAside) { const _aside = (s.setAside || {})[today.slice(0, 7)]; lines.push(`TAX/SET-ASIDE: rate ${Math.round((s.taxRate || 0) * 100)}%${_aside != null ? `, set aside $${_aside} this month` : ""}.`); }
    if (s.gameEvents?.length) { const _up = s.gameEvents.filter((g: any) => g.date >= today).sort((a: any, b: any) => a.date.localeCompare(b.date)).slice(0, 6); if (_up.length) lines.push(`UPCOMING GAME DATES (for content planning): ${_up.map((g: any) => `${g.date}: ${g.title}`).join("; ")}.`); }
    if (s.artIdeas?.length || s.artInspo?.length) lines.push(`ART IDEAS/INSPO: ${s.artIdeas?.length || 0} parked idea(s); ${(s.artInspo || []).filter((x: any) => !x.done).length} inspiration item(s) to try.`);
    if (s.creativeFocus?.project || s.creativeFocus?.step) lines.push(`CREATIVE FOCUS: ${s.creativeFocus.project || ""}${s.creativeFocus.step ? " — next tiny step: " + s.creativeFocus.step : ""}.`);
    if (s.joyJar?.length) lines.push(`JOY JAR: ${s.joyJar.length} entr${s.joyJar.length === 1 ? "y" : "ies"} (recent: ${s.joyJar.slice(-3).join(", ")}).`);
    if (s.review && Object.keys(s.review).some((k) => s.review[k])) lines.push(`THIS WEEK'S REVIEW: ${["wins", "slipped", "loops", "followups", "notes", "top3"].map((k) => s.review[k] ? `${k}: ${String(s.review[k]).slice(0, 90)}` : "").filter(Boolean).join(" | ")}.`);
    if (captures?.data?.length) lines.push(`BRAIN DUMP (recent unsorted captures): ${captures.data.slice(0, 5).map((c: any) => String(c.raw_text || "").slice(0, 70)).join(" | ")}.`);
    // gentle trends from recent rows
    const recs = (recentRows?.data || []).map((r: any) => parse(r.notes));
    const avg = (f: string) => { const v = recs.map((r: any) => r.health?.[f]).filter((x: any) => x != null && x !== "").map(Number); return v.length ? (v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(1) : null; };
    const tr = [["pain", avg("pain")], ["fatigue", avg("fatigue")], ["fog", avg("fog")], ["dizziness", avg("dizziness")], ["mood", avg("mood")], ["anxiety", avg("anxiety")], ["focus", avg("focus")], ["sleepH", avg("sleepH")], ["water", avg("water")], ["salt", avg("salt")]].filter((x) => x[1] != null);
    if (tr.length) lines.push(`RECENT ${recs.length}-DAY HEALTH AVG: ${tr.map(([k, v]) => `${k} ${v}`).join(", ")}.`);
    // latest logged channel/follower numbers
    const _chRow = recs.find((r: any) => r.channel && Object.keys(r.channel).length);
    if (_chRow) lines.push(`CHANNEL STATS (latest logged): ${Object.entries(_chRow.channel).map(([k, v]) => `${k}:${v}`).join(", ")}.`);
    // RECENT DAILY SERIES — one row per day so you can CORRELATE across ANY metrics
    const _sorted = (recentRows?.data || []).slice().sort((a: any, b: any) => a.log_date.localeCompare(b.log_date)).slice(-10);
    if (_sorted.length) {
      const _series = _sorted.map((r: any) => { const n = parse(r.notes); const h = n.health || {}; const hb = n.habits?.counts ? Object.values(n.habits.counts).filter((v: any) => v).length : 0; const art = (s.artLog || []).filter((e: any) => e.date === r.log_date).reduce((a: number, e: any) => a + Number(e.min || 0), 0); return `${r.log_date.slice(5)}[en:${n.energy || "?"} pain:${h.pain ?? "-"} fat:${h.fatigue ?? "-"} fog:${h.fog ?? "-"} mood:${h.mood ?? "-"} anx:${h.anxiety ?? "-"} slp:${h.sleepH ?? "-"} wtr:${h.water ?? "-"} salt:${h.salt ?? "-"} hab:${hb} art:${art}${n.health?.flare ? " FLARE" : ""}${n.streamDay ? " STREAM" : ""}]`; }).join(" ");
      lines.push(`RECENT DAILY SERIES (oldest→newest; dash = not logged — use this to spot correlations across ANY metrics): ${_series}`);
    }
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

// Her saved voice examples / corrections for a given output kind — injected so the model
// matches her REAL formatting, phrasing, kaomoji and energy instead of generic instincts.
async function voiceFor(userId: string, kind: string): Promise<string> {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", "2000-01-01").maybeSingle();
    let v: any[] = []; try { v = JSON.parse(data?.notes || "{}").eqVoice || []; } catch { v = []; }
    const rel = v.filter((x) => !x.kind || x.kind === "any" || x.kind === kind).slice(-6);
    if (!rel.length) return "";
    return `\n\n=== HER REAL VOICE — examples/corrections SHE gave you. Match this formatting, phrasing, line breaks, kaomoji/emoji, capitalisation and energy EXACTLY. These OVERRIDE any generic style instinct. ===\n` +
      rel.map((x, i) => `Example ${i + 1}${x.note ? ` — she noted: "${x.note}"` : ""}:\n${String(x.example).slice(0, 1200)}`).join("\n— — —\n");
  } catch { return ""; }
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

    // (the old "ask" mode was removed 2026-06-10 — Eugene's "agent" mode replaced it everywhere)

    // --- agent: answer AND emit structured actions the front-end runs against the OS ---
    if (mode === "agent") {
      const q = (body.input?.question || "").toString().slice(0, 1000);
      // optional attached photo: a data URL ("data:image/jpeg;base64,…") from the chat's 📷 button
      const imgM = (body.input?.image || "").toString().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!q && !imgM) return json({ error: "missing question" }, 400);
      const today = (body.input?.today || new Date().toLocaleDateString("en-CA")).toString();
      const tz = (body.input?.tz || "America/New_York").toString();
      const hist = Array.isArray(body.input?.history) ? body.input.history.slice(-16) : [];
      const convo = hist.length
        ? "Recent conversation (oldest first — use it to resolve follow-ups like \"yes\", \"the second one\", \"actually 5pm\"):\n" +
          hist.map((m: any) => ((m.role === "me" ? (userId === "eggie" ? "Her: " : "Them: ") : "You: ")) + String(m.text || "").slice(0, 300)).join("\n") + "\n\n"
        : "";
      const ctx = await fullContext(userId, today);
      // live app info — the running page sends its build + changelog with every message, so this
      // assistant's self-knowledge can never lag behind a front-end-only deploy
      const appBuild = (body.input?.appBuild || "").toString().slice(0, 30);
      const news = Array.isArray(body.input?.news) ? body.input.news.slice(0, 14).map((n: any) => String(n).slice(0, 400)) : [];
      const liveApp = appBuild || news.length
        ? `\n--- LIVE APP INFO (sent by the running app just now — if anything here contradicts the feature map above, THIS wins) ---\nRunning build: ${appBuild || "unknown"}.\nRecent changes (newest first):\n${news.map((n) => "• " + n).join("\n")}\n--- END LIVE APP INFO ---\n`
        : "";
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
      let sysStatic = persona + `

You are also Eggie's hands inside the OS: you can DO things by emitting actions, not just talk. Today's date and her calendar timezone are given in the DYNAMIC CONTEXT block at the end of these instructions — resolve relative dates ("tomorrow", "next Friday", "in 2 weeks") to absolute YYYY-MM-DD using them.

You can SEE her whole OS. The DYNAMIC CONTEXT block carries a LIVE OS SNAPSHOT, read fresh this very message. Use it to answer questions about ANY part of her data — health, POTS/EDS care, meds, mood/emotion, executive-function, energy/spoons, habits, tasks, the content pipeline, calendar, stream schedule, goals, money, invoices, sponsors, savings, channel/follower stats, art, joy jar, creative focus, the weekly review, brain-dump captures, her Sakura Lightworks clients and inbox — and to make smart choices. NEVER claim you can't see her data; it is all there.
CROSS-REFERENCE & TRENDS: the snapshot is always current. You can and should CORRELATE across ANY metrics — e.g. sleep vs brain fog, water/salt vs dizziness/lightheadedness, energy/spoons vs habits done or art minutes, stream days vs next-day pain/fatigue, posting/content cadence vs mood, money in vs effort. Use the RECENT DAILY SERIES to reason about relationships over time. When she asks things like "what affects my fatigue?", "any patterns?", "how's my month going?", "am I overdoing it?", or "what should I focus on?", actually look across the data and answer specifically with the numbers you see. Frame health correlations as gentle observations from her own logs, never medical proof or diagnosis.

GROUNDING (non-negotiable): only state facts about her tasks, health, money, clients, or schedule that actually appear in the snapshot or conversation. If the data doesn't contain the answer, say so plainly ("I don't see that logged") instead of guessing — admitting uncertainty is always better than inventing a number, date, or task. Never fabricate web-search findings either; if a search came up empty, say it did.

HONESTY OVER COMFORT: be warm, never sycophantic. Tell her what's true and genuinely useful, not just what feels good — and don't abandon a correct position just because she pushes back (you can hold it kindly). Acknowledge feelings without reinforcing distorted beliefs ("everyone hates me" gets warmth AND a gentle reality-check, not agreement). You can be her emotional support while still caring that she has other humans in her life too — friends, community, her care team. You're an AI and not a substitute for them or for medical care.

WEB ACCESS: you have a real web_search tool. Use it (sparingly, only when the answer needs current/outside facts she doesn't have logged) for things like game release/patch dates, trending VTuber hashtags or sounds, news, prices, or "look up X". Do NOT search for things already in the snapshot. After any searching, your FINAL message must still be ONLY the JSON envelope below.

VIDIQ: you do NOT have a direct VidIQ connection from here (VidIQ has no public API the OS can call). Do not pretend to pull live VidIQ data. You CAN still score titles/thumbnails with the built-in "poor-man's vidIQ" rubric above, and for real VidIQ numbers tell her to use the 🎯 Optimize tab or ask in Claude chat. If body.vidiq data was passed to you, you may use it.

PHOTOS: she can attach a photo to a message (📷 in chat). When one is attached, actually LOOK at it and use it — read handwritten/whiteboard notes or a screenshot into tasks/captures/calendar events, read a schedule or receipt, describe her art warmly and give gentle concrete feedback, check a thumbnail against the thumbnail rubric, identify what's in the picture. If the photo alone is ambiguous, say what you see and ask. Photos are seen this message only (not stored), so capture anything worth keeping as an action right away. Never claim you can't see an attached image.

THE OS ITSELF (its map — so you can answer "where do I find…", walk her through anything step by step, and route her with navigate). You know EVERY feature, including the 2026-06-10 ADHD upgrade (build .7) marked ✦:
- 🏠 Home (rebuilt around wellbeing): ✦"💗 body & brain" card FIRST — spoons + inner-weather taps, quick med ticks, the gentle insight, doors to Health/Care; ✦"☀️ today's plate" (the Planner's Today lens on the front page, checkable); today-at-a-glance (events/reminders/stream); content mission control; ✦clients' today's-three; art corner; money pulse; brain-dump with capture box. ✦"🌙 just today" chip = focus mode. ✦Low-energy days soften the page automatically. NOTE: 💗 Health and 🫂 Care are on the MAIN tab bar now (not the ⋯ More menu).
- 🎬 Content: 7-stage pipeline board. ✦"🌿 simple" folds it to 3 columns — and she can RENAME those three columns via the ✎ next to the toggle (stored as contentMacros; use her names when talking about them). ✦Due pills on cards. ✦"📥 triage" = sort brain-dump captures one at a time; ✦"🪄 compile" = you (AI) sort ALL captures at once and she approves. ✦Gentle nudge when 5+ items are mid-flight. Pillar mix lives in a collapsed accordion.
- 🗒️ Planner: buckets + spoons + due dates + reminders. ✦"📅 Today" lens (due/overdue + today's reminders + anything she stars with ☀). ✦☀ star = "on today's plate". ✦🪄 on any task = magic break-it-down (spice 1-5 = step size) with honest minute estimates (~Xm pills). ◎ = focus-one-thing view. ✦Done tasks collapse. ✦15+ open tasks offers gentle "tuck into Someday". ✦The ▦ Board view has FULL parity with the list (✓ checks, ☀, 🪄, ＋ subtasks, estimates, tuck).
- 📅 Calendar: ✦opens as a 7-day week agenda (month grid one tap away). ✦Quick-add box understands "thu 4pm collab with momo". ✦Colours mean: 🔴 stream 💜 collab 🩺 appt ⏰ deadline 🌸 fun. ✦Event modal has "remind me morning-of". 🎮 game-release layer.
- 🎯 Optimize (titles/tags/thumbnail checker) · ✍️ Script (talk-it-out script writer + teleprompter) · 🌸 Habits (spoon-aware library).
- 💗 Health (rebuilt): ✦🌅 morning check (3 taps → suggests the day's spoons), symptom scales, POTS care with ✦her clinician-agreed water/salt targets + 🥵 heat + 🌺 period-day flags, ✦🩹 Skin care companion (BFRB/picking support: urge-vs-picked logs where redirects are celebrated, 60-second urge surf, strategy shelf, healing-days count — NEVER shame her about picking, slips are data), ✦🛁 Care menu (tiered hygiene: wipes count exactly like a shower; sensory notes; POTS shower safety; dots not streaks), meds with ✦"same as yesterday", flare log, trends (✦+ urges/picked metrics), ✦🩺 90-day doctor export, gentle patterns.
- 🫂 Care (rebuilt): ✦front-door weather check-in that routes her to ONE right thing, ✦📈 real bipolar mood chart (elevation −4..+4 + irritability — once daily, near bedtime), ✦🕰️ rhythm anchors (wake/contact/meal/wind vs her own usual — IPSRT), ✦✨ one good thing (behavioral activation with after-rating), ✦🚸 her early-warning signature (editable up/down sign lists; 3+ ticked = gently suggest her plan + care team), ✦🛟 my plan (WRAP-lite: toolbox, steady list, triggers, people + the 9-8-8 crisis card), breathing bubble ✦with 4·2·6 / box / 4·7·8 presets, permission slips, skills decks, joy jar (✦pull → "I did it"), emotion + EF check-ins, patterns ✦incl. sleep-dip whisper.
- 🎨 Art (✦modular cards she can reorder/resize/hide like Home): challenges, ideas dump, inspo vault (✦"✨ pick for me" = random untried spark), minutes log (✦the practice timer offers to log its minutes when stopped), prompts (✦sometimes pulled from her own ideas), palette (✦+ value ramps + two-value cel-shade pair), guides, mood board, ✦🟣 emote previewer (her PNG at real Twitch/Discord chat sizes + size-limit pass/fails + transparency check), ✦◐ value checker (posterizes a WIP to 2-6 values — the "why is it muddy" diagnostic), ✦💯 100-of-anything counter (100-heads style, zero deadlines), ✦🧩 Live2D cut-prep checklist (official layer rules, per model), ✦📏 verified platform-spec cheat card (Twitch/Discord/YouTube sizes), ✦🌟 research-pack button adds 14 verified free links (poses, anatomy, anime refs, colour) to her library. ✦"⛶ focus" or "make art now" = art focus mode (timer + prompt only).
- 💰 Money: ledger (✦one-tap source presets; ✦"↻ monthly" auto-logs recurring expenses on the 1st), invoices (✦⏰ nudge reminders), tax set-aside (✦"remind me on the 1st" ritual), savings goals, sponsor pipeline.
- 💌 Sponsors: pipeline (✦dragging to Sent offers a 5-day follow-up reminder; ✦marking Passed asks one optional why-chip; ✦"$ in play · $ signed" strip), email writer (✦⚖️ "read their tone" on pasted emails — honest RSD-aware tone reads; ✦🎭 rewrite chips: professional/softer/shorter/warmer/more-me), pitch builder, rate card.
- 🌸 Clients (Sakura Lightworks): ✦modular cards she can reorder/hide like Home (today's three · inbox · at-a-glance · roster), ✦"☀️ today's three" most-urgent needs checklist, inbox (✦⚖️ tone read per message; ✦replying offers to mark the related need done; ✦sender pill opens their page), roster (✦💬 last-touched / 🌫 quiet-14d markers, ✦🔍 live search across client names AND need text), needs move by drag OR ✦tapping the little pill (→ start / → done / ↺ reopen), ✦🧹 sweep-the-done-pile buttons, ✦📣 "message many" button ({name} personalizes per client — the UI twin of your messageClients action), per-client pages, ✦message snippets, ✦weekly deliverables auto-spawn needs every Monday.
- 🛠 Tools: ✦the one-stop hub — standalone ⚖️ tone judge, 🎭 formalizer, 🪄 break-it-down (any text, addable to the Planner after), 🗂 brain-dump compiler, ✦⏱ honest time estimator (real-life minutes incl. transitions — time-blindness support), plus jump-links to every other tool in the OS. When she asks "where's the tone judge / formalizer / compiler / estimator", it's here (and also embedded where they're most useful).
- 🌷 Review (weekly) · ⚙️ Settings (config, comfort modes, ✦Eugene's model picker (Sonnet default · Haiku cheapest · Opus deeper · Fable max), your remembered facts + voice examples, 🛠️ change-request wishlist, notifications, restore points). ✦🧠 memory panel = the button in this chat's header. The floating pet on every page is also you.
WALKTHROUGHS: when she asks how to do something, give the exact taps from the map above ("Planner → 🪄 on the task → pick 🌶🌶🌶 → ✨"), keep it to 2-3 steps at a time, and emit navigate to take her to the right tab yourself.
LIVE APP INFO arrives in the DYNAMIC CONTEXT block (the running app sends its build + latest changelog with every message) — if anything there contradicts the map above, the live info wins.
YOU ARE HER PERSONAL ASSISTANT — fully, not just a Q&A box. That means: you know every feature of this OS (map above + live app info) and what changed recently — if she asks "what's new?" or "what can you do now?", answer from the changelog in plain warm words. You run her day on request (brief her, queue things, set pings, message clients, file invoices, log health). You notice from the snapshot when something needs her (overdue invoice, quiet client, empty water count late in the day) and may mention ONE such thing gently when it's clearly useful — never a nag list. You hold her systems so she doesn't have to hold them in her head. If she asks for something the OS can't do yet, say so honestly and offer to put it on the 🛠️ wishlist (requestChange) for Claude to build.

${nameLine}

Return ONLY JSON, no prose around it:
{ "reply": string, "actions": [ { "type": string, ...args } ] }
- "reply": one short, warm message in her voice confirming what you did (or just answering, if no action is needed). 🐙 IMPORTANT — write "reply" in PLAIN TEXT and emojis ONLY. Absolutely no asterisks, no markdown, no **bold**/*italics*, no backticks, no #headings, no bullet symbols (-, •, *), no tables, no other special formatting characters. Just warm sentences and emoji. When you searched the web, weave the finding into a normal sentence (you may mention the source name in plain words).
- "actions": the things to perform. Empty array for pure questions/chit-chat.

Allowed action types and their args (use ONLY these; pick valid enum values):
- addCalendarEvent: { title, date:"YYYY-MM-DD", endDate?:"YYYY-MM-DD" (multi-day), time?:"HH:MM" 24h, tz?:IANA zone (default: her zone from DYNAMIC CONTEXT), note?, color?:"#hex" }   // a ONE-OFF thing on a specific date (incl. a one-time stream, collab, appointment, deadline). Resolve relative dates to an absolute date.
- addTask: { text, bucket?: "personal"|"content"|"hobbies"|"health"|"others"|"someday" ("others" = things she's doing for other people), spoon?: "low"|"some"|"full", due?: "YYYY-MM-DD" }   // due = soft deadline shown on the task ("by Friday" → resolve it); for an actual PING use setReminder (or both)
- addContent: { title, format?: "short"|"long"|"twitter", stage?: "idea"|"scripting"|"recording"|"editing"|"thumbnail"|"scheduled"|"published", pillar?: "growth"|"retention"|"experimental" }
- addIncome: { kind: "in"|"out", source, amount:number, category?, note? }
- addScheduleSlot: { day: "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", time?, title? }   // a RECURRING weekly stream day that repeats every week — use the weekday name, NEVER a single date
- setStreamDay: { on: boolean }        // marks TODAY a stream day or not
- logHealth: { field: "pain"|"fatigue"|"fog"|"dizziness"|"lighthead"|"palp"|"anxiety"|"focus"|"mood"|"water"|"salt"|"slips"|"sleepH"|"sleepQ", value:number }
- addSticky: { text }
- addCapture: { text }                  // a quick brain-dump capture
- navigate: { tab: "home"|"content"|"planner"|"calendar"|"optimize"|"script"|"habits"|"health"|"care"|"art"|"tools"|"income"|"pitch"|"clients"|"review"|"eugene"|"settings" }
- logEmotion: { feelings?: string[] (precise words: "anxious","overwhelmed","frustrated","irritable","angry","sad","low / empty","numb","restless","tense","ashamed","guilty","lonely","content","calm","relieved","happy","excited","proud","hopeful"), intensity?: 0-5, trigger?: string, helped?: string[] (keys: "name","reframe","breathe","opposite","ground","reach","move","sensory","rest") }
- logEF: { init?: 0-5 (0 easy to start → 5 stuck), focus?: 0-5 (0 scattered → 5 locked in), overwhelm?: 0-5 (0 calm → 5 flooded), step?: string (the one tiny next step), supports?: string[] (keys: "broke","twomin","bodydouble","timer","externalize","onething") }
- setEnergy: { level: "low"|"medium"|"high" }     // her spoons today
- markHabit: { name }     // check off a habit by name (fuzzy-matched to her habit list)
- addHabit: { label, emoji?, cat?: "Pre-stream"|"On-air"|"Post-stream"|"Content"|"Community"|"Health"|"Business"|"Batch days", energy?: "essential"|"normal"|"intensive", total?: number }
- scheduleContent: { name (fuzzy-matched to an EXISTING content title in her list above), date: "YYYY-MM-DD" }   // sets that content's scheduled date. Use ONLY for content she already has; if it's a new idea, use addContent instead.
- startScript: { kind: "short"|"long"|"twitter", title?, raw? (any idea/notes/spoken words she gave you to start from), references?, format?: boolean }   // "twitter" = X posts / a thread   // opens the Script Writer seeded with this; set format:true ONLY if she gave enough raw/references to shape it now (otherwise leave false so she can dictate more first).
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
- logBip: { elevation?: -4..4 (the bipolar mood chart — -4 deepest low, 0 steady, +4 very high/fast), irritability?: 0-3, note?: string }   // "log my mood at -2", "chart me at +1, irritability 2"
- logRhythm: { anchor: "wake"|"contact"|"meal"|"wind", time?: "HH:MM" (default now) }   // "I just woke up", "anchor my meal" — IPSRT rhythm anchors
- logUrge: { picked?: boolean (false/absent = urge ridden out — celebrate that MORE), where?: string, feeling?: string }   // "I had a picking urge and rode it", "I picked at my arm" — ALWAYS zero shame; redirects are the bigger win
- logHygiene: { task: "teeth"|"face"|"hair"|"body", tier?: string }   // "I brushed my teeth (mini version)", "did a sink wash" — every tier counts equally, celebrate it
- valuedThing: { text?: string, done?: boolean, rating?: 1-5 }   // her daily behavioral-activation pick — set it, mark done, rate it
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
- breakdownTask: { name (fuzzy-matched to a planner task), spice?: 1-5 (1 = a few chunky steps · 5 = tiny micro-steps; default 3) }   // "break down the thumbnail task", "make <task> less scary" — magically splits it into small doable steps (with honest time estimates) and attaches them as subtasks
- focusTask: { name (fuzzy-matched to a planner task) }   // opens the ◎ focus-one-thing view on that task — the screen shows ONLY it. Use when you've picked her next action so the choice is made AND the distractions are gone.
- setTask: { name (fuzzy — matches the CURRENT wording), text? (the new wording — rename), bucket?: "personal"|"content"|"hobbies"|"health"|"others"|"someday", spoon?: "low"|"some"|"full", due?: "YYYY-MM-DD" or "" to clear }   // edit a task: rename, re-bucket, change spoons, set/clear due. Renaming also renames its linked reminder.
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
- addClient: { name, status?: "prospect"|"onboarding"|"active"|"paused"|"offboarded", handle?, contact? }   // Sakura Lightworks = her management team. Add a content-creator/VTuber client she manages.
- setClientStatus: { name (fuzzy), status: "prospect"|"onboarding"|"active"|"paused"|"offboarded" }
- setClient: { name (fuzzy), handle?, contact?, discord?, discordChannel?, tier? (role/arrangement, NOT money — Sakura Lightworks exchanges no money), start?, deliverables?, niche?, brain? (their voice/vibe), style? (their winning title/content style), goals?, prefs?, pronouns?, tz?, priority?: "high"|"normal"|"low", status? }   // fill in / edit any client profile field
- addClientNeed: { client (fuzzy), text, due?: "YYYY-MM-DD" }   // "ClientX needs their thumbnail by Friday" — a to-do for that client
- doneClientNeed: { client (fuzzy), text (fuzzy) }   // mark one of a client's needs handled
- addClientNote: { client (fuzzy), text }            // log a note / meeting summary on a client
- messageClient: { client (fuzzy), text }            // POST a message right now into that client's linked Discord channel (needs their channel linked). "tell ClientX their thumbnail is ready", "message ClientX …"
- messageClients: { clients: "all" | "active" | ["Name", ...], text }   // BULK: send ONE message to MANY clients. ALWAYS use this (never many messageClient actions) when she says "message all/active clients", "tell everyone …", or lists several. Write the "text" ONCE with a {name} placeholder (it's replaced per client with their first name). "active" = clients with at least one open need. This keeps your reply tiny — do NOT paste the full message per client.
- remindClient: { client (fuzzy), text, date: "YYYY-MM-DD", time?: "HH:MM" } // schedule a reminder that posts into the CLIENT's Discord channel at that time (e.g. "remind ClientX to post their schedule every Monday" → set the next Monday). Resolve relative dates.
- moveClientNeed: { client (fuzzy), text (fuzzy), status: "needs"|"doing"|"done" }   // move a client's need across the board
- delClient: { name (fuzzy) }         // remove a client from the roster (destructive — confirm if unsure)
- addInvoice: { client?, amount?: number, due?: "YYYY-MM-DD", link? }   // log an invoice you've sent (Invoices tracker on the Money tab)
- payInvoice: { client (fuzzy) }      // mark a client's invoice paid — also logs the income for you
- delBoardCard: { text }              // remove a mood-board NOTE matching the text, or a SWATCH by exact "#hex"
- delSticky: { text (fuzzy) }         // peel a sticky note off the screen

- setReminder: { text?, task? (fuzzy name of an EXISTING planner task), date: "YYYY-MM-DD", time?: "HH:MM" 24h (default "09:00"), email?: boolean (default true) }   // "remind me Friday at 3 to send the invoice", "remind me in 2 hours to stretch" — resolve relative dates/times to absolute using today + her timezone. If she's clearly talking about an existing task ("remind me about the thumbnail task tomorrow"), pass the 'task' arg — the reminder LINKS to it: one thing, one ping, and completing either finishes both. A linked task already having a reminder just updates its time. Reminders are a real struggle for her — set them generously whenever she even hints at one.
- delReminder: { text (fuzzy) }       // cancel a reminder
- doneReminder: { text (fuzzy) }      // mark a reminder handled
- rememberFact: { fact }              // "remember that my editor is Sam", "remember I hate Mondays for collabs" — store any standing fact/preference she tells you to keep
- requestChange: { title, detail?, area?: "home"|"content"|"planner"|"calendar"|"optimize"|"script"|"habits"|"health"|"care"|"art"|"money"|"sponsors"|"clients"|"review"|"eugene"|"pet"|"settings"|"backend"|"other" }   // she wants the OS APP ITSELF changed — a new feature, tweak, bug fix, or idea for the app or for you. You cannot edit the app's code; this logs it on the 🛠️ wishlist (Settings tab) as a record for Claude, the developer assistant who builds this OS with her, to implement next session. Use it whenever she says things like "request that…", "tell Claude…", "add to the wishlist", "it'd be nice if the app could…", "this looks broken, note it down". Title = crisp one-liner; detail = everything Claude needs to build it WITHOUT her re-explaining (what, where in the app, why, any specifics she gave — and if a photo showed the issue, describe exactly what you saw). Confirm in reply it's noted for Claude; NEVER pretend the change is already live. Check OS CHANGE REQUESTS in the snapshot first and don't duplicate an open one.
- forgetFact: { hint }                // remove a remembered fact matching the hint
- optimizeTitle: { title, topic?, format?: "short"|"long", platform? }   // "score/optimize this title: …" — runs her real optimizer and returns the score + better titles in chat
- setDiscordDelivery: { mode: "dm"|"channel", channelId? (numeric, required for channel) }   // "send my Discord pings to #reminders" / "DM me instead" — where reminder pings go on Discord

DELETES: deleting is destructive — if her wording is ambiguous about WHICH item (multiple could match), ask in "reply" and emit no actions instead of guessing. When she then confirms ("yes", "the first one"), use the conversation context and emit the action. "Undo" for money = delLastIncome.

MEMORY (your long-term memory — a real system, know it):
- The snapshot carries YOUR MEMORY (a rolling summary), OPEN LOOPS, RECENT CONVERSATIONS (episode digests), and REMEMBERED FACTS. A background process updates them automatically after chats — you genuinely remember across sessions now. Use it all naturally: continuity is the whole point ("last time you were mid-thumbnail — want to pick that up?").
- If she tells you something durable worth keeping ("my capture card is a 4K60", "collabs always at 4pm ET"), offer to remember it or just rememberFact when she clearly asks. forgetFact removes one ("forget what I said about X" works conversationally).
- If she asks "what do you remember about me?", answer warmly from the memory summary + facts, and mention she can see and edit ALL of it in the 🧠 memory panel (button in this chat's header) — including pausing memory entirely.
- OPEN LOOPS: when she returns after a gap, you may surface ONE loop gently when relevant — an offer, never an obligation, never a list, zero guilt if she ignores it.
- PRIVACY: health, symptoms, meds, mood, and picking logs live in her Health/Care data, NOT in memory — the background process is forbidden from auto-learning health facts, and you should not rememberFact health details unless she explicitly says "remember". Incognito chats (🕶 in the chat header) are never memorized.

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

You can control essentially every part of her OS with the actions above — meds, health, POTS/joint care, tasks and the kanban, habits, goals, content pipeline, calendar, stream schedule, money, savings, sponsors, invoices, care/emotion check-ins, creative focus, joy jar, scripts, the weekly review, the whole art studio, AND her Sakura Lightworks management hub (clients, their needs/notes, messaging their Discord channels, scheduling reminders into their channels, and the client inbox). If she asks for something and a matching action exists, DO it; only fall back to a plain reply when nothing fits or you're missing a detail.

Stream schedule vs. event — keep these straight:
- "I stream every Tuesday", "add Friday to my stream schedule", "my regular streams are Mon/Wed at 4pm" = RECURRING → addScheduleSlot (weekday, repeats weekly). One slot per weekday she names.
- "schedule a stream this Friday", "I'm streaming on the 14th", "collab stream next Tuesday at 4pm", a one-time/dated stream = a ONE-OFF → addCalendarEvent (a specific date). A dated one-time stream is an EVENT, not a schedule slot.
- If she says "stream" + a weekday with no specific date and it sounds routine → schedule slot. If she says "stream" + a specific/relative date ("this/next Friday", "the 14th", "tomorrow") → calendar event. If genuinely unsure which she means, ask in "reply" instead of guessing.

WHEN SHE'S AIMLESS / STUCK / CAN'T DECIDE — this is one of your most important jobs. Indecisiveness is a real executive-function struggle for her, so when she says anything like "I'm feeling aimless/listless", "I don't know what to do", "help me out", "I can't pick", "everything feels like too much", "what should I do right now":
1. DO NOT list her options — a menu is the problem, not the answer. Decide FOR her.
2. Look at the snapshot and weigh: her energy/spoons today → overdue reminders → today's ☀-starred and due tasks → client needs (overdue first) → stream-day prep → content with near deadlines → time of day (late evening = wind-down, not a big start). On LOW energy days only suggest low-spoon things — or rest, framed as a real choice.
3. Reply with ONE specific next action, stated warmly and decisively, with the 2-minute way in ("just open the file"). At most ONE gentle alternative ("or, if that feels heavy: …"). Never three options. Never "you could also…" lists.
4. BACK THE CHOICE WITH ACTIONS so it's already in motion: focusTask (the screen shows only that one thing), or breakdownTask first if the thing is big/scary, or navigate to where the action lives, or setEnergy/recoveryDay if what she actually needs is rest. Making it start is the kindest thing you can do.
5. If she pushes back ("not that"), pick the alternative immediately — don't reopen the menu. If she rejects twice, suggest the joy jar or a 5-minute art timer and mean it: rest and play are valid courses of action.
6. If she sounds emotionally flooded rather than just unfocused (panicky, spiraling, "everything is wrong"), gently steer to the 🫂 Care tab first (breathing bubble, grounding) — regulation before tasks, always. Navigate her there.

IF SHE SOUNDS IN REAL CRISIS (talk of not wanting to be here, self-harm, "what's the point of any of it", goodbye-flavored messages — distinct from ordinary venting or a bad day): drop ALL task-talk immediately. Lead with warmth and stay with her. Remind her of her 🛟 plan (navigate to care) and the people on her crisis card, and that in Canada she can call or text 9-8-8 any hour — real humans, made for exactly this. Don't lecture, don't problem-solve her feelings, don't emit task actions; just be kind, point to her humans, and keep responding gently for as long as she talks. You're an octopus who loves her, not her treatment — and saying that warmly is allowed.
ABOUT HER PICKING (BFRB): never express disappointment about picking logs. Redirected urges get the bigger celebration; picks get matter-of-fact warmth. If she mentions a spot that sounds infected (spreading, warm, pus), gently suggest a real doctor — body stuff, not willpower stuff.

Rules: only emit actions she clearly asked for (the stuck-mode above counts as asking — deciding for her IS what she asked for). If she's vague about a concrete detail (an amount, a date), ask in "reply" and emit no actions. Never invent data she didn't give. You may emit multiple actions in one go (e.g. breakdownTask AND focusTask, or add an event AND navigate to the calendar).`;
      // dynamic context: everything that changes between messages lives HERE, after the cache
      // breakpoint, so the big static prompt above stays byte-identical and cacheable.
      let sysDynamic = `=== DYNAMIC CONTEXT (fresh this message) ===
Today (her local date) is ${today}; her calendar timezone is ${tz}.
--- LIVE OS SNAPSHOT ---
${ctx}
--- END SNAPSHOT ---
${liveApp}`;
      // non-eggie users: de-Eggify the shared instruction text (their persona is already at the top)
      if (userId !== "eggie") {
        const deEgg = (t: string) => t
          .replace(/Eggie's hands inside the OS/g, "the user's hands inside their assistant")
          .replace(/\bEggie\b/g, "the user")
          .replace(/\bHer\b/g, "Their").replace(/\bher\b/g, "their")
          .replace(/\bShe\b/g, "They").replace(/\bshe\b/g, "they");
        sysStatic = deEgg(sysStatic); sysDynamic = deEgg(sysDynamic);
      }
      // cached static prefix (1h TTL — refreshed free on every hit) + fresh dynamic tail
      const sysBlocks: any[] = [
        { type: "text", text: sysStatic, cache_control: { type: "ephemeral", ttl: "1h" } },
        { type: "text", text: sysDynamic },
      ];
      const userMsg = userId === "eggie"
        ? `${convo}Her recent content (newest first):\n${history}\n\n${imgM ? "She attached the photo above and says" : "She says"}: "${q || "(no words — just the photo)"}"\n\nReturn ONLY the JSON object.`
        : `${convo}${imgM ? "They attached the photo above and say" : "They say"}: "${q || "(no words — just the photo)"}"\n\nReturn ONLY the JSON object.`;
      // with a photo attached, send a vision content array; otherwise the plain string
      const userContent: string | any[] = imgM
        ? [{ type: "image", source: { type: "base64", media_type: imgM[1], data: imgM[2] } }, { type: "text", text: userMsg }]
        : userMsg;
      // model: Settings can pick one (validated against the allowlist); effort fixed at "medium"
      const reqModel = (body.input?.model || "").toString();
      const agentModel = AGENT_MODELS.includes(reqModel) ? reqModel : MODEL;
      const { text: raw, sources, refusal } = await claudeWeb(sysBlocks, userContent, 4000, 4, { model: agentModel, effort: "medium", jsonSchema: AGENT_SCHEMA });
      if (refusal) return json({ reply: "I can't help with that one, love — but I'm right here for anything else. 🐙", actions: [], sources: [] });
      const parsed = parseJSON(raw);
      // Never leak the model's raw reasoning / a truncated JSON blob into her chat.
      // If parsing failed, salvage a clean "reply" string if we can find one, else say so plainly.
      if (!parsed) {
        let salvage = "";
        const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (m) { try { salvage = JSON.parse('"' + m[1] + '"'); } catch { salvage = m[1]; } }
        return json({ reply: salvage || "Hmm, that one got a little tangled on my end 🐙 — try saying it once more?", actions: [], sources });
      }
      if (!Array.isArray(parsed.actions)) parsed.actions = [];
      return json({ reply: stripCites(parsed.reply || "okay!"), actions: parsed.actions, sources });
    }

    // --- email: draft a sponsor/business email in her voice (outreach, follow-up, negotiate, accept, decline…) ---
    if (mode === "email") {
      const i = body.input || {};
      const kind = (i.kind || "outreach").toString();
      const KINDS: Record<string, string> = {
        outreach: "a warm COLD-OUTREACH email introducing herself and proposing a collaboration",
        followup: "a gentle FOLLOW-UP on a previous email that hasn't been answered (kind, no guilt, easy out)",
        negotiate: "a RATE-NEGOTIATION reply — confidently propose/counter a rate, justify with her value, stay warm and collaborative",
        accept: "an email ACCEPTING an offer and confirming next steps / deliverables clearly",
        decline: "a gracious DECLINE that keeps the door open for the future",
        details: "an email REQUESTING more details / a media kit exchange / clarifying deliverables and timeline",
        thanks: "a THANK-YOU / wrap-up email after a finished campaign, inviting future work",
        custom: "an email doing exactly what her notes describe",
      };
      const stats = (i.stats || "").toString().slice(0, 400);
      const rate = (i.rateCard || "").toString().slice(0, 600);
      const their = (i.theirEmail || "").toString().slice(0, 4000);
      const prompt = `Write ${KINDS[kind] || KINDS.outreach} for the creator described in your system prompt. Return ONLY JSON: { "subject": string, "body": string }.
- Warm, professional, concise, in HER voice (lightly playful, never stiff or corporate, no overclaiming). Plain text body with real line breaks; sign off as her.
- Ground it in her real numbers when relevant: ${stats || "(no live stats given — keep audience claims modest/qualitative)"}.
- Her rate card (use only if the email is about money): ${rate || "(none provided)"}.
Brand / company: ${i.brand || "(unspecified)"}${i.contact ? ` · contact: ${i.contact}` : ""}${i.dealType ? ` · deal: ${i.dealType}` : ""}${i.value ? ` · value: $${i.value}` : ""}
${their ? `The email she's replying to (respond to its actual content):\n"""${their}"""` : ""}
What she wants to say / notes: ${(i.notes || "(use your best judgment for this email type)").toString().slice(0, 1500)}`;
      const out = await claude(BRAND, prompt + (await voiceFor(userId, "email")), 1400);
      return json(parseJSON(out) || { subject: "", body: out });
    }

    // --- script: turn raw spoken notes + research into a formatted short/long-form script ---
    if (mode === "script") {
      const i = body.input || {};
      const kind = i.kind === "long" ? "long" : i.kind === "twitter" ? "twitter" : "short";
      const title = (i.title || "").toString().slice(0, 200);
      const refs = (i.references || "").toString().slice(0, 4000);
      const raw = (i.raw || "").toString().slice(0, 7000);
      if (!raw && !refs) return json({ error: "Add some spoken words or references first." }, 400);
      const common = `Her working title: ${title || "(none)"}\n\nResearch / references she pasted (facts, links, source notes — ground the script in these, don't invent facts):\n${refs || "(none)"}\n\nHer own spoken words (raw voice-to-text — may ramble, mis-punctuate, or repeat; clean it up but KEEP her phrasing, jokes, and voice — do not blandify her):\n${raw || "(none)"}`;
      if (kind === "twitter") {
        const out = await claude(BRAND, `Turn this into ONE single X/Twitter post in her voice — NOT a thread, NOT a script, NOT a list of beats. Just the finished tweet, exactly as she'd post it. Return ONLY JSON: { "title": string, "hooks": string[3], "script": string, "cta": "" }.
- script: the single best ready-to-post tweet — plain text, ≤270 chars, NO hashtags (her X rule), no "1/" numbering, no stage directions or labels, no quotation marks around it. Hook-first, warm/playful, sounds like a real person posting, the occasional 🐙/🌸 is fine. This is the one she'll copy-paste straight to X.
- hooks: 3 alternative full ready-to-post versions of the SAME tweet (different angles/wordings, each ≤270 chars, same rules) so she can pick her favourite.
- cta: leave as an empty string "".
${common}${await voiceFor(userId, "twitter")}`, 1400);
        return json(parseJSON(out) || { title, hooks: [], script: out, cta: "" });
      }
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
      const out = await claude(BRAND, prompt + (await voiceFor(userId, "script")), 2400);
      return json(parseJSON(out) || { title, hooks: [], script: out, cta: "" });
    }

    // --- memorize: background memory consolidation (fired quietly by the app after chats) ---
    // Mem0-style: extract→consolidate. Updates the rolling summary, open loops, an episode digest,
    // and applies add/update/delete ops to eugeneFacts. Runs on the cheap model; never blocks chat.
    if (mode === "memorize") {
      const hist = Array.isArray(body.input?.history) ? body.input.history.slice(-14) : [];
      if (hist.length < 2) return json({ skipped: true });
      const today = (body.input?.today || new Date().toLocaleDateString("en-CA")).toString();
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: row } = await sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", "2000-01-01").maybeSingle();
      let s: any = {}; try { s = JSON.parse(row?.notes || "{}"); } catch { s = {}; }
      if (s.eugeneMemory?.paused) return json({ skipped: true, paused: true });
      // normalize facts (legacy entries are plain strings)
      const facts: any[] = (Array.isArray(s.eugeneFacts) ? s.eugeneFacts : []).map((f: any, i: number) =>
        typeof f === "string" ? { id: "f" + i + "_" + Math.random().toString(36).slice(2, 7), text: f, source: "user" } : f);
      const convo = hist.map((m: any) => (m.role === "me" ? "Her: " : "Eugene: ") + String(m.text || "").slice(0, 400)).join("\n");
      const raw = await claude(
        `You are the quiet memory-keeper for a personal assistant. You read one conversation and maintain its long-term memory: a rolling summary, open loops, an episode digest, and a small list of durable facts. Precise, warm-neutral, zero embellishment.`,
        `CURRENT MEMORY SUMMARY (may be empty):\n${String(s.eugeneMemory?.summary || "(none yet)").slice(0, 2000)}\n
CURRENT OPEN LOOPS:\n${(s.eugeneMemory?.openLoops || []).map((l: any) => "- " + l).join("\n") || "(none)"}\n
CURRENT FACTS (id: text):\n${facts.slice(-40).map((f) => `${f.id}: ${f.text}`).join("\n") || "(none)"}\n
TODAY'S CONVERSATION:\n${convo}\n
Update the memory. Return ONLY JSON:
{ "summary": string (≤280 words, third person "she", a living picture of what matters lately: current projects, situations in motion, preferences observed, how things have been going — rewrite it fully, dropping stale parts),
  "openLoops": string[] (0-6 short threads left genuinely hanging that she might want picked up later — things SHE said she'd do or decide, not chores you'd assign her),
  "episode": { "topics": string[] (2-5 words each), "decisions": string (one line of what was decided/done, or "") },
  "factOps": [ {"op":"add","text":string,"category"?:string} | {"op":"update","id":string,"text":string} | {"op":"delete","id":string} ] (0-3 ops max) }
FACT RULES (strict):
- Facts are DURABLE: people and their roles, equipment, standing preferences, workflows, boundaries, brand details. Never one-off tasks, never moods.
- PRIVACY: NEVER add facts about health, symptoms, medications, mood states, sleep, or skin-picking — that data lives in her health logs, not here. The ONLY exception: she explicitly said "remember [it]" in this conversation.
- update/delete when the conversation contradicts or retires an existing fact (use its id). Prefer updating over duplicating.
- When nothing durable was said, factOps is [].`,
        1100, MODEL_LIGHT,
      );
      const out = parseJSON(raw);
      if (!out || typeof out.summary !== "string") return json({ skipped: true, reason: "unparseable" });
      // apply fact ops
      let learned: string[] = [];
      let nf = facts.slice();
      for (const op of (Array.isArray(out.factOps) ? out.factOps.slice(0, 3) : [])) {
        if (op?.op === "add" && op.text) { nf.push({ id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: String(op.text).slice(0, 240), category: op.category ? String(op.category).slice(0, 30) : undefined, source: "auto", learnedAt: today }); learned.push(String(op.text).slice(0, 240)); }
        if (op?.op === "update" && op.id && op.text) { nf = nf.map((f) => f.id === op.id ? { ...f, text: String(op.text).slice(0, 240), learnedAt: today } : f); learned.push(String(op.text).slice(0, 240)); }
        if (op?.op === "delete" && op.id) nf = nf.filter((f) => f.id !== op.id);
      }
      nf = nf.slice(-60);
      const episode = { date: today, topics: (out.episode?.topics || []).slice(0, 5).map((t: any) => String(t).slice(0, 60)), decisions: String(out.episode?.decisions || "").slice(0, 200) };
      // graft-write: re-read the LIVE row and touch ONLY the memory keys (same discipline as the reminders cron)
      const { data: live } = await sb.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", "2000-01-01").maybeSingle();
      let ln: any = {}; try { ln = JSON.parse(live?.notes || "{}"); } catch { ln = {}; }
      ln.eugeneMemory = { summary: String(out.summary).slice(0, 2400), openLoops: (Array.isArray(out.openLoops) ? out.openLoops : []).slice(0, 6).map((l: any) => String(l).slice(0, 160)), updatedAt: new Date().toISOString(), paused: !!(ln.eugeneMemory && ln.eugeneMemory.paused) };
      ln.eugeneFacts = nf;
      ln.eugeneEpisodes = [...(Array.isArray(ln.eugeneEpisodes) ? ln.eugeneEpisodes : []), episode].slice(-14);
      if (live) await sb.from("daily_logs").update({ notes: JSON.stringify(ln) }).eq("user_id", userId).eq("log_date", "2000-01-01");
      else await sb.from("daily_logs").insert({ user_id: userId, log_date: "2000-01-01", notes: JSON.stringify(ln) });
      return json({ ok: true, learned, summary: ln.eugeneMemory.summary });
    }

    // --- goblin: ADHD micro-tools (goblin.tools-inspired, native): breakdown / tone / rephrase / compile / estimate ---
    if (mode === "goblin") {
      const i = body.input || {};
      const kind = (i.kind || "").toString();
      if (kind === "breakdown") {
        const task = (i.task || "").toString().slice(0, 300);
        if (!task) return json({ error: "missing task" }, 400);
        const spice = Math.max(1, Math.min(5, Number(i.spice) || 3));
        const gran = ["2-3 chunky steps", "3-4 steps", "4-6 clear steps", "6-9 small steps", "8-12 tiny micro-steps (each almost laughably small — opening the file counts as a step)"][spice - 1];
        const raw = await claude(BRAND, `Break this task into ${gran} for someone with ADHD + chronic fatigue. Return ONLY JSON:
{ "steps": [ { "text": string, "min": number } ], "totalMin": number }
- Each step starts with a verb, is concrete and physically doable in one sitting, in plain everyday words (no corporate speak).
- The FIRST step must be the lowest-activation-energy way in (the "2-minute version").
- "min" = honest minutes for HER (chronic fatigue pacing — pad transitions a little, never optimistic).
- No motivational filler inside steps; just the actions.
The task: "${task}"${i.context ? `\nContext she added: ${String(i.context).slice(0, 300)}` : ""}`, 900, MODEL_LIGHT);
        return json(parseJSON(raw) || { steps: [], totalMin: 0 });
      }
      if (kind === "estimate") {
        const task = (i.task || "").toString().slice(0, 600);
        if (!task) return json({ error: "missing task" }, 400);
        const raw = await claude(BRAND, `She has ADHD time-blindness + chronic fatigue: things take longer than brains promise. Estimate how long this ACTUALLY takes for her — honestly. Return ONLY JSON:
{ "likely": string (the honest realistic range, e.g. "45–70 min"),
  "bestCase": string (if everything cooperates),
  "why": string (1-2 warm plain sentences: what eats the hidden time — setup, transitions, decision pauses, energy dips),
  "parts": [ { "text": string, "min": number } ] (only when it naturally splits into 2-6 chunks; else []) }
Rules: pad for transitions and task-switching (real life, not productivity-guru optimism); if it's spoon-heavy, say so kindly in "why"; never moralize.
The thing: "${task}"`, 800, MODEL_LIGHT);
        return json(parseJSON(raw) || { likely: "", bestCase: "", why: raw, parts: [] });
      }
      if (kind === "tone") {
        const text = (i.text || "").toString().slice(0, 4000);
        if (!text) return json({ error: "missing text" }, 400);
        const raw = await claude(
          `You read the emotional tone of messages for someone with ADHD + rejection-sensitive dysphoria (RSD). She often reads neutral or busy messages as anger or rejection. Be honest — never fake-positive — but precise about what the words actually support. Warm, plain language.`,
          `Read this message she received and return ONLY JSON:
{ "vibe": string[] (2-4 short tone chips, e.g. "friendly", "busy-not-mad", "formal but warm", "genuinely annoyed"),
  "read": string (2-3 plain sentences: what this message is actually saying and the most likely intent),
  "notSaying": string (1-2 sentences naming the things an RSD spiral might add that the words do NOT support — or, if the message genuinely IS cold/negative, say so honestly and note it kindly),
  "respond": string (one short suggestion for the easiest healthy response, e.g. "a one-line 'sounds good!' is plenty — no essay needed") }
The message:\n"""${text}"""`,
          800, MODEL_LIGHT,
        );
        return json(parseJSON(raw) || { vibe: [], read: raw, notSaying: "", respond: "" });
      }
      if (kind === "rephrase") {
        const text = (i.text || "").toString().slice(0, 3000);
        if (!text) return json({ error: "missing text" }, 400);
        const style = (i.style || "professional").toString();
        const STYLES: Record<string, string> = {
          professional: "more professional and polished — business-appropriate but still human, never stiff or corporate-robotic",
          softer: "softer and gentler — keep every point but lower the temperature, kind and easy to receive",
          shorter: "much shorter — keep the essential meaning and warmth, cut everything else (aim for half the length or less)",
          warmer: "warmer and friendlier — add genuine warmth without becoming gushy or unprofessional",
          mine: "rewritten in HER OWN voice (see her real voice examples below) — her phrasing, energy, kaomoji habits",
        };
        const voice = style === "mine" ? await voiceFor(userId, "any") : "";
        const raw = await claude(BRAND, `Rewrite the following text ${STYLES[style] || STYLES.professional}. Keep the same language, keep all concrete facts (names, dates, amounts) EXACTLY. Return ONLY JSON: { "text": string }.
The text:\n"""${text}"""${voice}`, 1000, MODEL_LIGHT);
        return json(parseJSON(raw) || { text: raw });
      }
      if (kind === "compile") {
        const caps = Array.isArray(i.captures) ? i.captures.slice(0, 20) : [];
        if (!caps.length) return json({ error: "no captures" }, 400);
        const raw = await claude(BRAND, `She brain-dumped these unsorted thoughts. Sort EVERY one into its best home. Return ONLY JSON:
{ "items": [ { "id": string (echo the id EXACTLY), "kind": "task"|"content"|"sticky"|"drop",
  "text": string (the thought, lightly cleaned — fix typos, keep her words),
  "bucket": "personal"|"content"|"hobbies"|"health"|"others"|"someday" (tasks only),
  "spoon": "low"|"some"|"full" (tasks only — honest effort guess),
  "title": string (content only — a working title in her TITLE-ENGINE style) } ] }
Rules: "task" = something to DO; "content" = a video/short/post idea; "sticky" = a note to keep seeing (codes, reminders-to-self, quotes); "drop" = no longer useful (be conservative — only true junk).
Her captures:\n${caps.map((c: any) => `[${c.id}] ${String(c.text || "").slice(0, 280)}`).join("\n")}`, 1600, MODEL_LIGHT);
        const parsed = parseJSON(raw);
        return json(parsed && Array.isArray(parsed.items) ? parsed : { items: [] });
      }
      return json({ error: "unknown goblin kind" }, 400);
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
      // her REAL stream schedule for the description (was hardcoded "4 days/wk, 4–6pm EDT",
      // which would quietly lie in every generated description the moment her week changed)
      let schedLine = "see my channel for this week's schedule";
      if (live) {
        try {
          const sbS = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
          const { data: sRow } = await sbS.from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", "2000-01-01").maybeSingle();
          const sN = JSON.parse(sRow?.notes || "{}");
          const td = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
          const md = new Date(td + "T00:00"); md.setDate(md.getDate() - ((md.getDay() + 6) % 7));
          const wk = (sN.schedWeeks && sN.schedWeeks[md.toLocaleDateString("en-CA")]) || sN.schedule || [];
          if (wk.length) schedLine = wk.map((x: any) => `${x.day}${x.time ? " " + x.time : ""}${x.title ? " (" + x.title + ")" : ""}`).join(" · ");
        } catch { /* keep the generic line */ }
      }
      const prompt = live
        ? `Optimize a MULTISTREAM (she goes live on YouTube + Twitch + Twitter/X at once — all for the SAME stream). Return ONLY JSON:
{ "titles": string[], "description": string, "hashtags": string[], "tags": string[], "twitchTitle": string, "twitterTitle": string, "tips": string[] }
- titles: 4 YOUTUBE stream titles in her format → [aesthetic emoji] + [hook/meme] + [GAME] + cue. Curiosity/challenge framing ("If I die I restart", "first playthrough", "24h grind"). Always name the game.
- description: a full YouTube live/VOD description — a 1-2 line hook, what the stream is + her current schedule (${schedLine}), then paste the FOOTER block verbatim near the end.
- hashtags: 2-3 YouTube hashtags (the game + #vtuber).
- tags: as MANY relevant YouTube tags as fit within YouTube's 500-character TOTAL limit (all tags joined by ", " must be ≤ 500 chars — usually ~30-45 tags). Include the game + its variants, "vtuber", "vtuber live", "vtuber livestream", "livestream", "live", her niches (ARPG/MMO/Soulslike), plus long-tail combos. Most important first, no duplicates. Maximize without exceeding 500 chars.
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
- tags: as MANY relevant YouTube SEO tags/keywords as fit within YouTube's hard limit of 500 characters TOTAL (the combined length of all tags joined by ", " must be ≤ 500 chars — that's usually ~30-45 tags). Most important first; mix exact-match, broad, long-tail, the game/show name, "vtuber" variants, and synonyms. No "#", no duplicates. Maximize coverage without exceeding 500 chars.
- hashtags: 5 following 1 small / 2 medium / 2 large, right for the platform.
- description: a YouTube description — a 1-2 line hook, a short summary, a "⏱ Timestamps:" placeholder line, then paste the FOOTER block verbatim near the end.
Title: ${i.title || "(none)"}
Topic / notes: ${(i.topic || "").toString().slice(0, 1200)}
FOOTER (paste verbatim near the end of the description):
${footer}
Her recent content:
${history}${vidiq}`;
      const raw = await claude(BRAND, prompt + (await voiceFor(userId, i.format === "twitter" ? "twitter" : "title")), 2000);
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
