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
import { todayBits } from "../_shared/today.ts";

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
const OWNER = Deno.env.get("BRIEFING_USER_ID") || "eggie";

async function postChannel(channelId: string, content: string, ping?: string): Promise<boolean> {
  const tok = Deno.env.get("DISCORD_BOT_TOKEN"); if (!tok || !channelId) return false;
  try {
    // ping = a Discord user ID ("12345…") or role mention. Prepend the @mention and
    // explicitly allow it (Discord suppresses pings unless allowed_mentions lists them).
    let body = String(content); const am: any = { parse: [] };
    const id = String(ping || "").replace(/[^0-9]/g, "");
    if (id) {
      const isRole = /^<@&/.test(String(ping)) || /role/i.test(String(ping));
      body = (isRole ? `<@&${id}> ` : `<@${id}> `) + body;
      if (isRole) am.roles = [id]; else am.users = [id];
    }
    const r = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST", headers: { authorization: `Bot ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({ content: body.slice(0, 1990), allowed_mentions: am }),
    });
    return r.ok;
  } catch { return false; }
}
// the single shared "talent" Discord role to @ when posting to client channels (set in Settings)
async function talentRole(userId: string): Promise<string> {
  try { const s = await loadSent(userId); return String(s?.appConfig?.talentRole || "").replace(/[^0-9]/g, ""); } catch { return ""; }
}
async function findClient(userId: string, by: { name?: string; channelId?: string }): Promise<any> {
  const s = await loadSent(userId); const cs = s.clients || [];
  if (by.channelId) { const c = cs.find((x: any) => String(x.discordChannel || "") === String(by.channelId)); if (c) return c; }
  if (by.name) { const nm = by.name.toLowerCase(); return cs.find((x: any) => (x.name || "").toLowerCase().includes(nm)) || null; }
  return null;
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
    case "setReminder": {
      if ((!a.text && !a.task) || !a.date) return "";
      let tid: string | null = null, txt = a.text || "";
      if (a.task) { const s = await loadSent(userId); const tk = (s.tasks || []).find((x: any) => !x.done && fuzzy(x.text, a.task)); if (tk) { tid = tk.id; if (!txt) txt = tk.text; } }
      if (!txt) return `couldn't find a task like “${a.task}” 🌸`;
      await saveSent(userId, (n) => {
        const rems = (n.reminders || []).slice();
        if (tid) { const ex = rems.find((x: any) => x.taskId === tid && !x.done); if (ex) { ex.date = a.date; ex.time = a.time || "09:00"; ex.pings = 0; ex.lastPing = null; ex.emailed = false; return { ...n, reminders: rems }; } }
        rems.push({ id: uid(), text: String(txt).slice(0, 300), date: a.date, time: a.time || "09:00", email: a.email !== false, done: false, notified: false, emailed: false, taskId: tid || undefined, pings: 0 });
        return { ...n, reminders: rems };
      });
      return `⏰ reminder set — ${a.date} ${a.time || "09:00"}: ${txt}${tid ? " 🔗 linked to the task" : ""}`;
    }
    case "delReminder": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, reminders: (n.reminders || []).filter((r: any) => { if (!hit && fuzzy(r.text, a.text)) { hit = r; return false; } return true; }) })); return hit ? `🗑 removed “${hit.text}”` : "couldn't find that reminder 🌸"; }
    case "doneReminder": { let hit: any = null; await saveSent(userId, (n) => { const rs = (n.reminders || []).map((r: any) => { if (!hit && !r.done && fuzzy(r.text, a.text)) { hit = r; return { ...r, done: true }; } return r; }); let ts = n.tasks || []; if (hit?.taskId) ts = ts.map((t: any) => t.id === hit.taskId ? { ...t, done: true, status: "done" } : t); return { ...n, reminders: rs, tasks: ts }; }); return hit ? `✅ “${hit.text}” done${hit.taskId ? " (+ its task)" : ""}` : "couldn't find that reminder 🌸"; }
    case "addTask":
      await saveSent(userId, (n) => ({ ...n, tasks: [...(n.tasks || []), { id: "t" + uid(), text: a.text || "task", bucket: a.bucket || "personal", spoon: a.spoon || "some", due: a.due || undefined, done: false, sub: [], created_at: new Date().toISOString() }] }));
      return `🗒️ added task “${a.text}”${a.due ? ` (due ${a.due})` : ""}`;
    case "completeTask": { let hit: any = null; const dn = a.done !== false; await saveSent(userId, (n) => { const ts = (n.tasks || []).map((t: any) => { if (!hit && fuzzy(t.text, a.name)) { hit = t; return { ...t, done: dn, status: dn ? "done" : "todo" }; } return t; }); let rs = n.reminders || []; if (hit && dn) rs = rs.map((r: any) => (r.taskId === hit.id && !r.done) ? { ...r, done: true } : r); return { ...n, tasks: ts, reminders: rs }; }); return hit ? `✅ checked off “${hit.text}”` : "couldn't find that task 🌸"; }
    case "delTask": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, tasks: (n.tasks || []).filter((t: any) => { if (!hit && fuzzy(t.text, a.name)) { hit = t; return false; } return true; }) })); return hit ? `🗑 removed “${hit.text}”` : "couldn't find that task 🌸"; }
    case "setTask": { let hit: any = null; await saveSent(userId, (n) => { const ts = (n.tasks || []).map((t: any) => { if (!hit && fuzzy(t.text, a.name)) { hit = t; const o = { ...t }; if (a.text) o.text = String(a.text).slice(0, 300); if (a.bucket) o.bucket = a.bucket; if (a.spoon) o.spoon = a.spoon; if (a.due !== undefined) o.due = a.due || undefined; return o; } return t; }); let rs = n.reminders || []; if (hit && a.text) rs = rs.map((r: any) => (r.taskId === hit.id && !r.done) ? { ...r, text: String(a.text).slice(0, 300) } : r); return { ...n, tasks: ts, reminders: rs }; }); return hit ? `🗂️ updated “${a.text || hit.text}”` : "couldn't find that task 🌸"; }
    case "addCapture":
      await sb().from("raw_captures").insert({ user_id: userId, raw_text: a.text || "" });
      return "🐙 captured it";
    case "refreshGameUpdates": {
      const res = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/analyze", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "gameUpdates", userId }),
      });
      const r = await res.json();
      const td = todayStr();
      const evs = ((r.events || []) as any[]).filter((e) => e && e.date && e.title && e.date >= td).slice(0, 15);
      if (!evs.length) return "🎮 looked around — nothing new officially announced right now 🌸";
      await saveSent(userId, (n) => {
        const titles = evs.map((e) => (e.title || "").toLowerCase());
        const cur = (n.gameEvents || []).filter((x: any) => x.date >= td && titles.indexOf((x.title || "").toLowerCase()) < 0);
        return { ...n, gameEvents: cur.concat(evs) };
      });
      return `🎮 refreshed — ${evs.length} upcoming: ${evs.slice(0, 4).map((e) => `${e.title} (${e.date})`).join(" · ")}${evs.length > 4 ? " + more" : ""}`;
    }
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
    case "delCalendarEvent": { let hit: any = null; const nm = (a.title || "").toLowerCase(); await saveSent(userId, (n) => ({ ...n, calendarEvents: (n.calendarEvents || []).filter((ev: any) => { const m = (ev.title || "").toLowerCase().includes(nm) && (!a.date || ev.date === a.date); if (m && !hit) { hit = ev; return false; } return true; }) })); return hit ? `🗑 removed “${hit.title}” (${hit.date})` : "couldn't find an event like that 🌸"; }
    case "moveCalendarEvent": { let hit: any = null; const nm = (a.title || "").toLowerCase(); await saveSent(userId, (n) => { const evs = (n.calendarEvents || []).slice(); const ev = evs.find((x: any) => (x.title || "").toLowerCase().includes(nm)); if (ev && a.date) { hit = ev; ev.date = a.date; } return { ...n, calendarEvents: evs }; }); return hit ? `📅 moved “${hit.title}” to ${a.date}` : "couldn't find an event like that 🌸"; }
    // desktop-pet settings: persona/name/email live on the user's own sentinel (the AI + cron read them there)
    case "setAssistantPrompt": {
      await saveSent(userId, (n) => ({ ...n, appConfig: { ...(n.appConfig || {}), ...(a.prompt !== undefined ? { assistantPrompt: String(a.prompt).slice(0, 4000) } : {}), ...(a.name !== undefined ? { assistantName: String(a.name).slice(0, 60) } : {}), ...(a.email !== undefined ? { email: String(a.email).slice(0, 120) } : {}) } }));
      return "⚙️ saved";
    }
    case "requestChange":
      if (!a.title) return "";
      await saveSent(userId, (n) => { const r = (n.osChangeRequests || []).slice(); r.push({ id: uid(), date: todayStr(), title: String(a.title).slice(0, 200), detail: String(a.detail || "").slice(0, 1200), area: String(a.area || "other").slice(0, 20), status: "new" }); return { ...n, osChangeRequests: r.slice(-100) }; });
      return "🛠️ noted on the wishlist for Claude — it's saved in Settings → 🛠️ change requests";
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
    case "delCalendarEvent": {
      const nm = (a.title || "").toLowerCase(); let hit: any = null;
      await saveSent(userId, (n) => ({ ...n, calendarEvents: (n.calendarEvents || []).filter((ev: any) => { const m = (ev.title || "").toLowerCase().includes(nm) && (!a.date || ev.date === a.date); if (m && !hit) { hit = ev; return false; } return true; }) }));
      return hit ? `🗑 removed “${hit.title}” (${hit.date})` : `couldn't find an event like “${a.title || ""}”`;
    }
    case "moveCalendarEvent": {
      const nm = (a.title || "").toLowerCase(); let hit: any = null;
      await saveSent(userId, (n) => { const evs = (n.calendarEvents || []).slice(); const ev = evs.find((x: any) => (x.title || "").toLowerCase().includes(nm)); if (ev && a.date) { hit = ev; ev.date = a.date; if (ev.endDate && ev.endDate < a.date) ev.endDate = a.date; } return { ...n, calendarEvents: evs }; });
      return hit ? `📅 moved “${hit.title}” to ${a.date}` : `couldn't find an event like “${a.title || ""}”`;
    }
    case "addContent":
      await sb().from("content_items").insert({ user_id: userId, title: a.title || "idea", format: a.format || "short", stage: a.stage || "idea", pillar: a.pillar || null, priority: 60, criteria: {}, hashtags: [] });
      return `🎬 added content “${a.title}”`;
    case "logArt":
      await saveSent(userId, (n) => ({ ...n, artLog: [...(n.artLog || []), { date: todayStr(), min: Number(a.minutes) || 0, note: a.note || undefined }] }));
      return `🎨 logged ${Number(a.minutes) || 0} min of art — proud of you 💗`;
    case "addJoy":
      await saveSent(userId, (n) => ({ ...n, joyJar: [...(n.joyJar || []), a.text || "a little joy"] }));
      return "🫙 added to the joy jar";
    case "messageClient": {
      const c = await findClient(userId, { name: a.client }); if (!c) return `couldn't find a client like “${a.client}” 🌸`;
      if (!c.discordChannel) return `${c.name} has no Discord channel linked yet 🌸`;
      // @ the shared "talent" role (one role for all clients) unless this message opts out (a.ping===false)
      const role = a.ping === false ? "" : await talentRole(userId);
      const ok = await postChannel(c.discordChannel, a.text || "", role ? `<@&${role}>` : ""); return ok ? `💬 sent to ${c.name}'s channel${role ? " (pinged talent)" : ""}` : `couldn't post to ${c.name}'s channel 🌸`;
    }
    case "remindClient": {
      const c = await findClient(userId, { name: a.client }); if (!c) return `couldn't find a client like “${a.client}” 🌸`;
      if (!c.discordChannel) return `${c.name} has no Discord channel linked 🌸`;
      if (!a.date) return "when should I remind them? 🌸";
      await saveSent(userId, (n) => ({ ...n, reminders: [...(n.reminders || []), { id: uid(), text: a.text || "reminder", date: a.date, time: a.time || "10:00", done: false, toChannel: c.discordChannel, role: a.ping === false ? "" : String(n?.appConfig?.talentRole || ""), who: c.name, email: false, pings: 0 }] }));
      return `⏰ I'll remind ${c.name} in their channel on ${a.date}${a.time ? " at " + a.time : ""}`;
    }
    case "addClient":
      await saveSent(userId, (n) => ({ ...n, clients: [...(n.clients || []), { id: uid(), name: a.name || "client", status: a.status || "prospect", handle: a.handle || "", contact: a.contact || "", platforms: [], tasks: [], notes: [], created: todayStr() }] }));
      return `🌸 added ${a.name || "client"} to Sakura Lightworks`;
    case "setClientStatus": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, clients: (n.clients || []).map((c: any) => { if (!hit && fuzzy(c.name, a.name)) { hit = c; return { ...c, status: a.status || c.status }; } return c; }) })); return hit ? `🌸 ${hit.name} → ${a.status}` : `couldn't find a client like “${a.name}” 🌸`; }
    case "addClientNeed": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, clients: (n.clients || []).map((c: any) => { if (!hit && fuzzy(c.name, a.client)) { hit = c; return { ...c, tasks: [...(c.tasks || []), { id: uid(), text: a.text || "need", status: "needs", due: a.due || "", done: false }] }; } return c; }) })); return hit ? `🔴 ${hit.name} needs “${a.text}”${a.due ? " by " + a.due : ""}` : `couldn't find a client like “${a.client}” 🌸`; }
    case "doneClientNeed": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, clients: (n.clients || []).map((c: any) => fuzzy(c.name, a.client) ? { ...c, tasks: (c.tasks || []).map((t: any) => { if (!hit && !t.done && fuzzy(t.text, a.text)) { hit = t; return { ...t, status: "done", done: true }; } return t; }) } : c) })); return hit ? `✅ marked “${hit.text}” done` : "couldn't find that need 🌸"; }
    case "addClientNote": { let hit: any = null; await saveSent(userId, (n) => ({ ...n, clients: (n.clients || []).map((c: any) => { if (!hit && fuzzy(c.name, a.client)) { hit = c; return { ...c, notes: [...(c.notes || []), { id: uid(), date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }), text: a.text || "" }] }; } return c; }) })); return hit ? `📝 noted for ${hit.name}` : `couldn't find a client like “${a.client}” 🌸`; }
    case "addInvoice": {
      await saveSent(userId, (n) => ({ ...n, invoices: [...(n.invoices || []), { id: uid(), client: (a.client || a.name || "invoice"), amount: Number(a.amount) || 0, due: a.due || "", link: a.link || "", status: "sent", created: todayStr() }] }));
      return `🧾 invoice added${a.client ? " for " + a.client : ""}${a.amount ? " · $" + a.amount : ""}`;
    }
    case "payInvoice": {
      const s = await loadSent(userId); const iv = (s.invoices || []).find((x: any) => x.status !== "paid" && fuzzy(x.client, a.client || a.name));
      if (!iv) return "couldn't find an unpaid invoice like that 🌸";
      await saveSent(userId, (n) => ({ ...n, invoices: (n.invoices || []).map((x: any) => x.id === iv.id ? { ...x, status: "paid", paid_on: todayStr() } : x) }));
      if (Number(iv.amount)) await sb().from("income_entries").insert({ user_id: userId, kind: "in", source: "sponsor", amount: Number(iv.amount), month: todayStr().slice(0, 8) + "01", note: "invoice · " + (iv.client || "") });
      return `✅ ${iv.client || "invoice"} marked paid${Number(iv.amount) ? " — logged $" + iv.amount : ""} 💗`;
    }
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

/* ---------- /today brief — built from the SHARED today-builder (same code as the briefing email) ---------- */
async function todayBrief(userId: string): Promise<string> {
  const s = await loadSent(userId);
  const b = todayBits(s);
  const lines: string[] = [];
  b.slots.forEach((slot: any) => lines.push(`🔴 stream day — ${slot.title || "stream"}${slot.time ? " · " + slot.time : ""}`));
  b.events.forEach((e: any) => lines.push(`📅 ${e.title}${e.time ? " · " + e.time : ""}`));
  b.dueReminders.forEach((r: any) => lines.push(`⏰ ${r.text}${r.date < b.today ? " (overdue)" : r.time ? " · " + r.time : ""}`));
  if (b.openTasks) lines.push(`🗒️ ${b.openTasks} open task${b.openTasks > 1 ? "s" : ""}`);
  if (b.artChallenge && !b.artChallenge.done) lines.push(`🎨 art challenge: ${b.artChallenge.text}`);
  return ("hi! 🐙 today:\n" + (lines.length ? lines.map((x) => "• " + x).join("\n") : "a clear slate — the day is yours 🌸")).slice(0, 1900);
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
  { name: "sakura", description: "Send a note / request to the Sakura Lightworks team 🌸", options: [{ type: 3, name: "message", description: "what do you need?", required: true }] },
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

  // ---- relay from the owner's OWN web app (no Discord signature): post to a client channel / set a
  //      client reminder. Gated by the publishable apikey header; execAction only ever touches the
  //      owner's own clients' channels, so it can't message anyone else. ----
  let pre: any = null; try { pre = JSON.parse(body); } catch { /* not JSON */ }

  // ---- op:"pet" — the desktop-pet door (Fable etc.). Post-lockdown the pet can't touch the
  //      tables with the publishable key, so it talks through here instead, gated by a per-user
  //      petToken stored on THAT user's sentinel row. The owner's tag is hard-blocked: her data
  //      is only reachable through her signed-in OS. First run "adopts" the name by claiming the
  //      token (optionally requiring the PET_ADOPT_KEY secret so strangers can't squat tags). ----
  if (pre && pre.op === "pet") {
    const petUser = String(pre.userId || "").trim();
    const token = String(pre.token || "");
    if (!petUser || petUser === OWNER || petUser === "eggie") return json({ error: "that name isn't available" }, 403);
    try {
      const s = await loadSent(petUser);
      const have = String(s?.appConfig?.petToken || "");
      if (pre.kind === "adopt") {
        const adoptKey = Deno.env.get("PET_ADOPT_KEY") || "";
        if (adoptKey && String(pre.adoptKey || "") !== adoptKey) return json({ error: "adoption needs the family key" }, 403);
        if (!token || token.length < 12) return json({ error: "token too short" }, 400);
        if (have && have !== token) {
          // family key = master key: a build carrying the right PET_ADOPT_KEY may RE-adopt the name
          // (his new PC, a reinstall, or Eggie test-driving the exe before gifting). Without the
          // family key configured, first-claim-wins stands and strangers can't take over a pet.
          if (!adoptKey) return json({ error: "this name is already adopted on another device" }, 403);
          await saveSent(petUser, (n) => ({ ...n, appConfig: { ...(n.appConfig || {}), petToken: token } }));
          return json({ ok: true, adopted: petUser, readopted: true });
        }
        if (!have) await saveSent(petUser, (n) => ({ ...n, appConfig: { ...(n.appConfig || {}), petToken: token } }));
        return json({ ok: true, adopted: petUser });
      }
      if (!have || have !== token) return json({ error: "unauthorized" }, 401);
      if (pre.kind === "read") return json({ ok: true, notes: s });
      if (pre.kind === "act") { const m = await execAction(petUser, pre.action || {}); return json({ ok: true, message: m }); }
      if (pre.kind === "patch") {
        const ALLOW = ["reminders", "tasks", "eugeneFacts", "calendarEvents", "appConfig"];
        const key = String(pre.key || "");
        if (!ALLOW.includes(key)) return json({ error: "key not allowed" }, 400);
        let val: any = pre.value;
        if (JSON.stringify(val ?? null).length > 250000) return json({ error: "too big" }, 413);
        if (key === "appConfig") {
          if (typeof val !== "object" || Array.isArray(val) || !val) return json({ error: "bad value" }, 400);
          val = { ...(s.appConfig || {}), ...val, petToken: have };   // settings merge; the token can't be stripped or changed here
        } else if (!Array.isArray(val)) return json({ error: "bad value" }, 400);
        await saveSent(petUser, (n) => ({ ...n, [key]: val }));
        return json({ ok: true });
      }
      return json({ error: "unknown kind" }, 400);
    } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
  }

  if (pre && pre.op === "relay") {
    const rk = Deno.env.get("RELAY_KEY");
    if (rk && req.headers.get("apikey") !== rk && req.headers.get("x-relay-key") !== rk) return json({ error: "unauthorized" }, 401);
    if (!req.headers.get("apikey")) return json({ error: "missing apikey" }, 401);
    // Who's calling? Post-lockdown the web app sends the owner's Supabase Auth JWT — verify it.
    // Pre-lockdown grace: if the project still allows anonymous table reads (lockdown SQL not run
    // yet), accept the publishable key alone, exactly like before. Once locked, a JWT is required —
    // so a stranger reading the key out of the page source can no longer message client channels.
    try {
      const anon = createClient(Deno.env.get("SUPABASE_URL")!, req.headers.get("apikey")!);
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      let okUser = false;
      if (jwt) { try { const { data } = await anon.auth.getUser(jwt); okUser = !!data?.user; } catch { okUser = false; } }
      if (!okUser) {
        // grace only while the project is genuinely pre-lockdown. ⚠ RLS hides rows WITHOUT an error,
        // so "no error" is NOT proof of open access — rows must actually come back.
        const { data: probe, error } = await anon.from("daily_logs").select("log_date").limit(1);
        if (error || !probe || !probe.length) return json({ error: "sign in to the OS to use the relay 🌸" }, 401);
      }
    } catch { return json({ error: "unauthorized" }, 401); }
    try { const m = await execAction(pre.userId || OWNER, pre.action || {}); return json({ ok: true, message: m }); }
    catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
  }

  if (!(await verifyReq(req, body))) return new Response("invalid request signature", { status: 401 });
  const i = pre || JSON.parse(body);

  if (i.type === 1) return json({ type: 1 }); // PING → PONG

  // ---- client-facing: /sakura <message> → drops into the owner's inbox (anyone in a client channel can use it) ----
  if (i.type === 2 && i.data?.name === "sakura") {
    const msg = (i.data?.options || []).find((o: any) => o.name === "message")?.value || "";
    const channelId = i.channel_id || "";
    const who = i.member?.user?.global_name || i.member?.user?.username || i.user?.global_name || i.user?.username || "someone";
    const c = await findClient(OWNER, { channelId });
    await saveSent(OWNER, (n) => ({ ...n, inbox: [...(n.inbox || []), { id: uid(), from: c?.name || who, who, text: String(msg).slice(0, 700), clientId: c?.id || null, clientName: c?.name || null, channelId, date: new Date().toISOString(), read: false }] }));
    return json({ type: 4, data: { content: "📨 sent to the Sakura Lightworks team — thank you! 🌸", flags: 64 } });
  }

  const discordUser = i.member?.user?.id || i.user?.id || "";
  const tag = userTag(discordUser);
  if (!tag) return json({ type: 4, data: { content: "aw — this is a private little octopus. 🐙 (you can use /sakura to leave a note for the team though!)", flags: 64 } });
  const appId = Deno.env.get("DISCORD_APP_ID")!;

  // ---- buttons on reminder DMs: dn:<id> / snz:<id> ----
  if (i.type === 3) {
    const [act, rid] = String(i.data?.custom_id || "").split(":");
    if (act === "dn") {
      await saveSent(tag, (n) => {
        let tid: string | null = null;
        const rems = (n.reminders || []).map((r: any) => { if (r.id === rid) { if (r.taskId) tid = r.taskId; return { ...r, done: true }; } return r; });
        let tasks = n.tasks || [];
        if (tid) tasks = tasks.map((t: any) => t.id === tid ? { ...t, done: true, status: "done" } : t);
        return { ...n, reminders: rems, tasks };
      });
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
