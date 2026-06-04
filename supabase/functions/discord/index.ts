// =============================================================================
// Eggie OS — "discord" Edge Function 🐙💬
// Eugene on Discord: an HTTP-interactions bot (no always-on server needed).
// Discord POSTs signed interactions here; slow AI work runs as a background
// task after a deferred "thinking…" reply.
//
// Slash commands: /ask /remind /task /capture /idea /inspo /today /done
// Buttons: ✓ done + 😴 snooze on reminder DMs (sent by the reminders cron).
//
// Secrets:
//   DISCORD_PUBLIC_KEY  (App → General Information)
//   DISCORD_APP_ID      (same page)
//   DISCORD_BOT_TOKEN   (App → Bot → Reset Token)
//   DISCORD_OWNER_ID    (your Discord user id — right-click yourself → Copy User ID)
//   DISCORD_USER_MAP    optional JSON {"<discordId>":"<osUserTag>"} for extra people
//
// Deploy:   supabase functions deploy discord --no-verify-jwt
// Register: GET <function-url>?register=1   (one time — creates the slash commands)
// Then paste the function URL into Discord → General Information →
// INTERACTIONS ENDPOINT URL.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const TZ = "America/Toronto";
const API = "https://discord.com/api/v10";
const SENTINEL = "2000-01-01";

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const uid = () => crypto.randomUUID().slice(0, 8);
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

function userTag(discordId: string): string | null {
  if (discordId === Deno.env.get("DISCORD_OWNER_ID")) return "eggie";
  try { const m = JSON.parse(Deno.env.get("DISCORD_USER_MAP") || "{}"); return m[discordId] || null; } catch { return null; }
}

/* ---------- sentinel JSON helpers (server-side twin of the web app's DB layer) ---------- */
async function loadSent(userId: string): Promise<any> {
  const { data } = await sb().from("daily_logs").select("notes").eq("user_id", userId).eq("log_date", SENTINEL).maybeSingle();
  try { return data?.notes ? JSON.parse(data.notes) : {}; } catch { return {}; }
}
async function saveSent(userId: string, mut: (n: any) => any) {
  const n = await loadSent(userId);
  const out = mut(n) || n;
  await sb().from("daily_logs").upsert(
    { user_id: userId, log_date: SENTINEL, notes: JSON.stringify(out), updated_at: new Date().toISOString() },
    { onConflict: "user_id,log_date" },
  );
}

/* ---------- server-side action executor (mirror of the web app's, core subset) ---------- */
async function execAction(userId: string, a: any): Promise<string> {
  if (!a || !a.type) return "";
  const fuzzy = (s: string, q: string) => (s || "").toLowerCase().includes((q || "").toLowerCase());
  switch (a.type) {
    case "setReminder":
      if (!a.text || !a.date) return "";
      await saveSent(userId, (n) => ({ ...n, reminders: [...(n.reminders || []), { id: uid(), text: String(a.text).slice(0, 300), date: a.date, time: a.time || "09:00", email: a.email !== false, done: false, notified: false, emailed: false, pushed: false, dmed: false }] }));
      return `⏰ reminder set — ${a.date} ${a.time || "09:00"}: ${a.text}`;
    case "delReminder": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, reminders: (n.reminders || []).filter((r: any) => { if (!hit && fuzzy(r.text, a.text)) { hit = r; return false; } return true; }) })); return hit ? `🗑 removed “${hit.text}”` : "couldn't find that reminder 🌸"; }
    case "doneReminder": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, reminders: (n.reminders || []).map((r: any) => { if (!hit && !r.done && fuzzy(r.text, a.text)) { hit = r; return { ...r, done: true }; } return r; }) })); return hit ? `✅ “${hit.text}” done` : "couldn't find that reminder 🌸"; }
    case "addTask":
      await saveSent(userId, (n) => ({ ...n, tasks: [...(n.tasks || []), { id: "t" + uid(), text: a.text || "task", bucket: a.bucket || "personal", spoon: a.spoon || "some", done: false, sub: [], created_at: new Date().toISOString() }] }));
      return `🗒️ added task “${a.text}”`;
    case "completeTask": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, tasks: (n.tasks || []).map((t: any) => { if (!hit && fuzzy(t.text, a.name)) { hit = t; return { ...t, done: a.done !== false, status: a.done !== false ? "done" : "todo" }; } return t; }) })); return hit ? `✅ checked off “${hit.text}”` : "couldn't find that task 🌸"; }
    case "delTask": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, tasks: (n.tasks || []).filter((t: any) => { if (!hit && fuzzy(t.text, a.name)) { hit = t; return false; } return true; }) })); return hit ? `🗑 removed “${hit.text}”` : "couldn't find that task 🌸"; }
    case "addCapture":
      await sb().from("raw_captures").insert({ user_id: userId, raw_text: a.text || "" });
      return "🐙 captured it";
    case "setDiscordDelivery": {
      const md = a.mode === "channel" ? "channel" : "dm"; const cid = String(a.channelId || "").replace(/[^0-9]/g, "");
      if (md === "channel" && !cid) return "I need the channel ID — right-click the channel → Copy Channel ID 🌸";
      await saveSent(userId, (n) => ({ ...n, discordNotify: { mode: md, channelId: cid } }));
      return md === "channel" ? "📢 pings will post in that channel" : "📩 pings will come as private DMs";
    }
    case "rememberFact":
      if (!a.fact) return "";
      await saveSent(userId, (n) => { const f = (n.eugeneFacts || []).slice(); f.push(String(a.fact).slice(0, 300)); return { ...n, eugeneFacts: f.slice(-40) }; });
      return "🧠 got it — I'll remember that";
    case "forgetFact": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, eugeneFacts: (n.eugeneFacts || []).filter((x: string) => { if (!hit && fuzzy(x, a.hint)) { hit = x; return false; } return true; }) })); return hit ? "🧠 forgotten" : "no memory like that 🌸"; }
    case "addArtIdea":
      await saveSent(userId, (n) => ({ ...n, artIdeas: [...(n.artIdeas || []), { id: uid(), text: String(a.text || "").slice(0, 300), added: todayStr() }] }));
      return "💡 parked in your ideas dump";
    case "addInspo":
      if (!a.url) return "";
      await saveSent(userId, (n) => ({ ...n, artInspo: [...(n.artInspo || []), { id: uid(), url: a.url, note: a.note || "", done: false, added: todayStr() }] }));
      return "✨ saved to your inspiration vault";
    case "addCalendarEvent":
      await saveSent(userId, (n) => ({ ...n, calendarEvents: [...(n.calendarEvents || []), { id: uid(), title: a.title || "event", date: a.date || todayStr(), endDate: a.endDate || "", time: a.time || "", tz: a.tz || "America/New_York", note: a.note || "", color: "#f6b8d4" }] }));
      return `📅 added “${a.title}” on ${a.date}${a.time ? " at " + a.time : ""}`;
    case "addContent":
      await sb().from("content_items").insert({ user_id: userId, title: a.title || "idea", format: a.format || "short", stage: a.stage || "idea", pillar: a.pillar || null, priority: 60, criteria: {}, hashtags: [] });
      return `🎬 added content “${a.title}”`;
    case "logArt":
      await saveSent(userId, (n) => ({ ...n, artLog: [...(n.artLog || []), { date: todayStr(), min: Number(a.minutes) || 0, note: a.note || undefined }] }));
      return `🎨 logged ${Number(a.minutes) || 0} min of art — proud of you 💗`;
    case "addJoy":
      await saveSent(userId, (n) => ({ ...n, joyJar: [...(n.joyJar || []), a.text || "a little joy"] }));
      return "🫙 added to the joy jar";
    default:
      return ""; // web-app-only actions (navigation, optimizer UI, …) just no-op here
  }
}

/* ---------- the brain: reuse the deployed analyze function (agent mode) ---------- */
async function runAgent(userId: string, q: string): Promise<string> {
  const res = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "agent", userId, input: { question: q, today: todayStr(), tz: "America/New_York" } }),
  });
  const r = await res.json();
  if (r.error) throw new Error(r.error);
  const did: string[] = [];
  for (const a of (r.actions || [])) { try { const m = await execAction(userId, a); if (m) did.push(m); } catch (_) { /* skip */ } }
  let reply = String(r.reply || (did.length ? "done!" : "okay!"));
  if (did.length) reply += "\n\n" + did.join("\n");
  return reply.slice(0, 1900);
}

/* ---------- /today brief ---------- */
async function todayBrief(userId: string): Promise<string> {
  const s = await loadSent(userId);
  const today = todayStr();
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(new Date().toLocaleString("en-US", { timeZone: TZ })).getDay()];
  const slot = (s.schedule || []).find((x: any) => (x.day || "").slice(0, 3) === wd);
  const evs = (s.calendarEvents || []).filter((e: any) => e.date === today || (e.endDate && e.date <= today && e.endDate >= today));
  const rems = (s.reminders || []).filter((r: any) => !r.done && r.date <= today);
  const tasks = (s.tasks || []).filter((t: any) => !t.done).length;
  const ch = s.artChallenge || {};
  const bits = [];
  if (slot) bits.push(`🔴 stream day — ${slot.title || "stream"}${slot.time ? " · " + slot.time : ""}`);
  evs.forEach((e: any) => bits.push(`📅 ${e.title}${e.time ? " · " + e.time : ""}`));
  rems.forEach((r: any) => bits.push(`⏰ ${r.text}${r.date < today ? " (overdue)" : r.time ? " · " + r.time : ""}`));
  if (tasks) bits.push(`🗒️ ${tasks} open task${tasks > 1 ? "s" : ""}`);
  if (ch.dayText && !ch.dayDone) bits.push(`🎨 art challenge: ${ch.dayText}`);
  return ("hi! 🐙 today:\n" + (bits.length ? bits.map((b) => "• " + b).join("\n") : "a clear slate — the day is yours 🌸")).slice(0, 1900);
}

/* ---------- Discord plumbing ---------- */
function hexToU8(hex: string) { const u = new Uint8Array(hex.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return u; }
async function verifyReq(req: Request, body: string): Promise<boolean> {
  try {
    const sig = req.headers.get("x-signature-ed25519"), ts = req.headers.get("x-signature-timestamp");
    if (!sig || !ts) return false;
    const key = await crypto.subtle.importKey("raw", hexToU8(Deno.env.get("DISCORD_PUBLIC_KEY") || ""), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToU8(sig), new TextEncoder().encode(ts + body));
  } catch { return false; }
}
async function patchOriginal(appId: string, token: string, content: string) {
  await fetch(`${API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1990) }),
  });
}
const COMMANDS = [
  { name: "ask", description: "Ask Eugene anything — your OS, the web, or just chat 🐙", options: [{ type: 3, name: "question", description: "what do you want to know / do?", required: true }] },
  { name: "remind", description: "Set a reminder in plain words (\"tomorrow at 3pm to send the invoice\") ⏰", options: [{ type: 3, name: "about", description: "what + when, any wording", required: true }] },
  { name: "task", description: "Add a task to your planner 🗒️", options: [{ type: 3, name: "text", description: "the task", required: true }] },
  { name: "capture", description: "Brain-dump a thought before it escapes 🐙", options: [{ type: 3, name: "text", description: "the thought", required: true }] },
  { name: "idea", description: "Park an art idea in your ideas dump 💡", options: [{ type: 3, name: "text", description: "the idea", required: true }] },
  { name: "inspo", description: "Save a link to your inspiration vault ✨", options: [{ type: 3, name: "link", description: "URL", required: true }, { type: 3, name: "note", description: "why it sparked you", required: false }] },
  { name: "today", description: "Your day at a glance — stream, events, reminders, challenge ☀️" },
  { name: "done", description: "Mark a reminder (or task) done by name ✅", options: [{ type: 3, name: "what", description: "part of its name", required: true }] },
].map((c) => ({ ...c, type: 1, integration_types: [0, 1], contexts: [0, 1, 2] })); // guild + user install; usable in servers, bot DMs, private channels

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // one-time slash-command registration: GET <url>?register=1
  if (req.method === "GET") {
    if (url.searchParams.get("register") === "1") {
      const appId = Deno.env.get("DISCORD_APP_ID"), tok = Deno.env.get("DISCORD_BOT_TOKEN");
      if (!appId || !tok) return json({ error: "Set DISCORD_APP_ID and DISCORD_BOT_TOKEN secrets first." }, 400);
      const r = await fetch(`${API}/applications/${appId}/commands`, { method: "PUT", headers: { authorization: `Bot ${tok}`, "content-type": "application/json" }, body: JSON.stringify(COMMANDS) });
      const d = await r.json();
      return json(r.ok ? { ok: true, registered: (d || []).map((c: any) => "/" + c.name) } : { error: d }, r.ok ? 200 : 500);
    }
    return json({ ok: true, hint: "POST = Discord interactions · GET ?register=1 = register slash commands" });
  }

  const body = await req.text();
  if (!(await verifyReq(req, body))) return new Response("invalid request signature", { status: 401 });
  const i = JSON.parse(body);

  if (i.type === 1) return json({ type: 1 }); // PING → PONG

  const discordUser = i.member?.user?.id || i.user?.id || "";
  const tag = userTag(discordUser);
  if (!tag) return json({ type: 4, data: { content: "aw — this is a private little octopus. 🐙 (ask Eggie to add your Discord id)", flags: 64 } });
  const appId = Deno.env.get("DISCORD_APP_ID")!;

  // ---- buttons on reminder DMs: dn:<id> / snz:<id> ----
  if (i.type === 3) {
    const [act, rid] = String(i.data?.custom_id || "").split(":");
    if (act === "dn") {
      await saveSent(tag, (n) => ({ ...n, reminders: (n.reminders || []).map((r: any) => r.id === rid ? { ...r, done: true } : r) }));
      return json({ type: 7, data: { content: (i.message?.content || "") + "\n✅ done — nice!", components: [] } });
    }
    if (act === "snz") {
      const dt = new Date(new Date().toLocaleString("en-US", { timeZone: TZ })); dt.setHours(dt.getHours() + 1);
      const t2 = ("0" + dt.getHours()).slice(-2) + ":" + ("0" + dt.getMinutes()).slice(-2);
      await saveSent(tag, (n) => ({ ...n, reminders: (n.reminders || []).map((r: any) => r.id === rid ? { ...r, date: todayStr(), time: t2, notified: false, emailed: false, pushed: false, dmed: false, pings: 0, lastPing: null } : r) }));
      return json({ type: 7, data: { content: (i.message?.content || "") + `\n😴 snoozed to ${t2}`, components: [] } });
    }
    return json({ type: 6 });
  }

  // ---- slash commands ----
  if (i.type === 2) {
    const cmd = i.data?.name;
    const opt = (n: string) => (i.data?.options || []).find((o: any) => o.name === n)?.value || "";

    // fast, direct DB writes — answer inline (well under 3s)
    if (cmd === "task") { const m = await execAction(tag, { type: "addTask", text: opt("text") }); return json({ type: 4, data: { content: m } }); }
    if (cmd === "capture") { const m = await execAction(tag, { type: "addCapture", text: opt("text") }); return json({ type: 4, data: { content: m } }); }
    if (cmd === "idea") { const m = await execAction(tag, { type: "addArtIdea", text: opt("text") }); return json({ type: 4, data: { content: m } }); }
    if (cmd === "inspo") { const m = await execAction(tag, { type: "addInspo", url: opt("link"), note: opt("note") }); return json({ type: 4, data: { content: m } }); }
    if (cmd === "today") { const m = await todayBrief(tag); return json({ type: 4, data: { content: m } }); }
    if (cmd === "done") {
      let m = await execAction(tag, { type: "doneReminder", text: opt("what") });
      if (m.startsWith("couldn't")) m = await execAction(tag, { type: "completeTask", name: opt("what") });
      return json({ type: 4, data: { content: m } });
    }

    // slow (Claude) — defer now, patch the answer in when ready
    if (cmd === "ask" || cmd === "remind") {
      const q = cmd === "remind" ? `set a reminder: ${opt("about")}` : opt("question");
      const work = (async () => {
        try { await patchOriginal(appId, i.token, await runAgent(tag, q)); }
        catch (e) { await patchOriginal(appId, i.token, "aw, my brain hiccuped: " + String((e as Error)?.message || e).slice(0, 200) + " 🌸"); }
      })();
      // @ts-ignore — Supabase edge runtime global
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
      return json({ type: 5 }); // "Eugene is thinking…"
    }
  }
  return json({ type: 4, data: { content: "hmm, I don't know that one 🌸", flags: 64 } });
});
