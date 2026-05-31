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
Be kind, be concrete, and reference her own past content when it's relevant.`;

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
      if (!Object.keys(out).length) return json({ error: "Nothing to pull — set YOUTUBE_API_KEY (+ channel id) and/or a Discord invite." }, 400);
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

    if (mode === "optimize") {
      const i = body.input || {};
      const raw = await claude(
        BRAND,
        `Optimize this video for ${i.platform || "YouTube"} (${i.format || "long-form"}). Return ONLY JSON:
{ "titleScore": number, "titleWhy": string, "titles": string[], "tags": string[], "hashtags": string[] }
- titleScore: 0-100 estimated click potential; titleWhy: 1-2 sentences.
- titles: 4 stronger options (curiosity/specificity; put searchable words where they help).
- tags: 12-15 YouTube SEO tags / keywords, most important first.
- hashtags: 5 following 1 small / 2 medium / 2 large, right for the platform.

Title: ${i.title || "(none)"}
Topic / notes: ${(i.topic || "").toString().slice(0, 1200)}
Her recent content:
${history}${vidiq}`,
        1800,
      );
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
