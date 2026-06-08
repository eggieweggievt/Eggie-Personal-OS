// =============================================================================
// Eggie OS — "reminders" Edge Function ⏰🐙
// Cron-driven (every ~5 min). Now MULTI-USER: loops every tag in REMINDER_USERS
// (default: just BRIEFING_USER_ID/eggie) and, for each user's due reminders:
// sends a WEB PUSH to their subscribed devices, an email via Resend, and a
// Discord DM with ✓/😴 buttons. GET requests return the VAPID public key.
//
// Per-user routing:
//   email      → their sentinel appConfig.email (eggie falls back to BRIEFING_TO)
//   discord DM → eggie → DISCORD_OWNER_ID; others → reverse lookup in
//                DISCORD_USER_MAP {"<discordId>":"<osUserTag>"}
//   push       → their own sentinel pushSubs
//
// Secrets:  RESEND_API_KEY  (email)
//           VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY  (web push)
//           BRIEFING_TO / BRIEFING_FROM / BRIEFING_USER_ID / BRIEFING_LINK
//           DISCORD_BOT_TOKEN / DISCORD_OWNER_ID / DISCORD_USER_MAP
//           REMINDER_USERS  e.g. "eggie,fabled"  (optional; default single-user)
// Deploy:   supabase functions deploy reminders --no-verify-jwt
// Cron:     */5 * * * *  → invoke "reminders", body {}
// Times are interpreted in America/Toronto.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const DEFAULT_USER = Deno.env.get("BRIEFING_USER_ID") || "eggie";
const USERS = (Deno.env.get("REMINDER_USERS") || DEFAULT_USER).split(",").map((s) => s.trim()).filter(Boolean);
const TO = Deno.env.get("BRIEFING_TO") || "eggie@eggieweggie.ca";
const FROM = Deno.env.get("BRIEFING_FROM") || "Eggie OS <onboarding@resend.dev>";
const TZ = "America/Toronto";

function esc(s: unknown) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }

function discordIdFor(user: string): string | null {
  if (user === DEFAULT_USER || user === "eggie") return Deno.env.get("DISCORD_OWNER_ID") || null;
  try {
    const m = JSON.parse(Deno.env.get("DISCORD_USER_MAP") || "{}");
    for (const [discordId, tag] of Object.entries(m)) if (tag === user) return discordId;
  } catch { /* bad map */ }
  return null;
}

async function processUser(sb: any, user: string, today: string, hm: string) {
  const { data: sent } = await sb.from("daily_logs").select("notes").eq("user_id", user).eq("log_date", "2000-01-01").maybeSingle();
  let notes: any = {}; try { notes = sent?.notes ? JSON.parse(sent.notes) : {}; } catch { notes = {}; }

  // ---- rolling 7-day sentinel snapshot: copy today's sentinel to a per-weekday backup row
  //      (log_date 1999-01-01 … 1999-01-07) once per day. Restoring = copy a backup row's
  //      notes back onto 2000-01-01. Cheap insurance against overwrites. ----
  try {
    if (sent?.notes) {
      const wd = new Date(today + "T00:00").getDay();                 // 0–6
      const snapDate = "1999-01-0" + (wd + 1);
      const { data: snap } = await sb.from("daily_logs").select("updated_at").eq("user_id", user).eq("log_date", snapDate).maybeSingle();
      const snapDay = snap?.updated_at ? String(snap.updated_at).slice(0, 10) : "";
      if (snapDay !== new Date().toISOString().slice(0, 10)) {
        await sb.from("daily_logs").upsert(
          { user_id: user, log_date: snapDate, notes: sent.notes, updated_at: new Date().toISOString() },
          { onConflict: "user_id,log_date" },
        );
      }
    }
  } catch { /* snapshots must never break reminders */ }
  const rems: any[] = notes.reminders || [];
  const petName = notes.appConfig?.assistantName || (user === "eggie" ? "Eugene" : "your assistant");
  const userEmail = notes.appConfig?.email || (user === "eggie" ? TO : null);

  // Nagging by design (kindly): while a due reminder isn't done/snoozed, push + Discord
  // re-ping every NAG_MINUTES, up to NAG_MAX waves, then rest. Email goes once.
  const NAGMIN = Number(Deno.env.get("NAG_MINUTES") || 30);
  const MAXP = Number(Deno.env.get("NAG_MAX") || 4);
  const isDue = (r: any) => !r.done && (r.date < today || (r.date === today && (r.time || "09:00") <= hm));
  const waveOK = (r: any) => (Date.now() - (r.lastPing ? Date.parse(r.lastPing) : 0)) >= NAGMIN * 60000 && (r.pings || 0) < MAXP;
  // client-channel reminders post ONCE to the linked Discord channel (not to the owner)
  const dueChan = rems.filter((r) => isDue(r) && r.toChannel && !r.posted);
  let posted = 0;
  const dTokC = Deno.env.get("DISCORD_BOT_TOKEN");
  if (dueChan.length && dTokC) {
    for (const r of dueChan) {
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${r.toChannel}/messages`, {
          method: "POST", headers: { authorization: `Bot ${dTokC}`, "content-type": "application/json" },
          body: JSON.stringify({ content: `⏰ ${r.text} 🌸` }),
        });
        if (res.ok) { (r as any)._postok = true; posted++; }
      } catch { /* retry next tick */ }
    }
  }
  const dueWave = rems.filter((r) => isDue(r) && !r.toChannel && waveOK(r));
  const duePush = dueWave, dueDm = dueWave;
  const dueEmail = rems.filter((r) => isDue(r) && !r.toChannel && !r.emailed && r.email !== false);
  if (!dueWave.length && !dueEmail.length && !dueChan.length) return { user, push: 0, email: 0, dm: 0, chan: posted };

  // ---- Discord ping with ✓ done / 😴 snooze buttons ----
  // Destination is per-user: sentinel notes.discordNotify = {mode:"dm"|"channel", channelId}
  // (set in Settings → Notifications, or by telling the assistant). Default: private DM.
  let dmed = 0;
  const dTok = Deno.env.get("DISCORD_BOT_TOKEN"), dTarget = discordIdFor(user);
  if (dueDm.length && dTok && dTarget) {
    try {
      const pref = notes.discordNotify || { mode: "dm", channelId: "" };
      const useChannel = pref.mode === "channel" && pref.channelId;
      let chId = useChannel ? String(pref.channelId) : "";
      if (!chId) {
        const ch = await fetch("https://discord.com/api/v10/users/@me/channels", {
          method: "POST", headers: { authorization: `Bot ${dTok}`, "content-type": "application/json" },
          body: JSON.stringify({ recipient_id: dTarget }),
        }).then((x) => x.json());
        chId = ch?.id || "";
      }
      if (chId) {
        for (const r of dueDm) {
          const res2 = await fetch(`https://discord.com/api/v10/channels/${chId}/messages`, {
            method: "POST", headers: { authorization: `Bot ${dTok}`, "content-type": "application/json" },
            body: JSON.stringify({
              // in a server channel the <@mention> is what actually pings her phone; DMs ping on their own
              content: `${useChannel ? `<@${dTarget}> ` : ""}${(r.pings || 0) > 0 ? `🔁 nudge ${(r.pings || 0) + 1}/${MAXP} · ` : ""}⏰ ${r.text}${r.time ? `  ·  ${r.date} ${r.time}` : ""} ${user === "eggie" ? "🐙" : "✨"}`,
              components: [{ type: 1, components: [
                { type: 2, style: 3, label: "✓ done", custom_id: `dn:${r.id}` },
                { type: 2, style: 2, label: "😴 snooze 1h", custom_id: `snz:${r.id}` },
              ] }],
            }),
          });
          if (res2.ok) { (r as any)._dmok = true; dmed++; }
          else if (useChannel) {
            // bad channel id / missing permission → flip this user back to DMs so pings never silently die
            notes.discordNotify = { mode: "dm", channelId: "" };
            break;
          }
        }
      }
    } catch { /* failures just retry next tick */ }
  }

  // ---- web push to every subscribed device ----
  let pushedDevices = 0;
  const VPUB = Deno.env.get("VAPID_PUBLIC_KEY"), VPRIV = Deno.env.get("VAPID_PRIVATE_KEY");
  if (duePush.length && VPUB && VPRIV && Array.isArray(notes.pushSubs) && notes.pushSubs.length) {
    webpush.setVapidDetails("mailto:" + (userEmail || TO), VPUB, VPRIV);
    const payload = JSON.stringify({
      title: duePush.length > 1 ? `⏰ ${duePush.length} reminders` : `⏰ ${petName} reminder`,
      body: duePush.map((r) => r.text).join(" · ").slice(0, 180),
      url: "https://" + (Deno.env.get("BRIEFING_LINK") || "eggieweggievt.github.io/Eggie-Personal-OS/"),
    });
    const alive: any[] = [];
    for (const s of notes.pushSubs) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload); alive.push(s); pushedDevices++; }
      catch (e: any) {
        const code = e?.statusCode || 0;
        if (code === 404 || code === 410) { /* device unsubscribed — drop it */ }
        else alive.push(s);
      }
    }
    notes.pushSubs = alive;
  }

  // ---- email (Resend) ----
  let emailId: string | null = null;
  const key = Deno.env.get("RESEND_API_KEY");
  if (dueEmail.length && key && userEmail) {
    const li = (r: any) => `<li style="margin:5px 0;font-size:15px"><b>${esc(r.text)}</b> <span style="color:#9b8aa0;font-size:12px">(${esc(r.date)}${r.time ? " · " + esc(r.time) : ""})</span></li>`;
    const html = `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #f0dcec;border-radius:16px;padding:22px;color:#4a3a4d">
      <div style="font-size:20px;font-weight:700;color:#db5e98;margin-bottom:6px">⏰ ${esc(petName)} here — gentle nudge${dueEmail.length > 1 ? "s" : ""}!</div>
      <ul style="margin:8px 0;padding-left:18px">${dueEmail.map(li).join("")}</ul>
      <p style="margin:14px 0 0;color:#7c6a80;font-size:13px">No pressure, no guilt — this is just so it doesn't slip. You've got this. ${user === "eggie" ? "🐙💗" : "💙"}</p>
    </div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [userEmail], subject: `⏰ ${dueEmail.length > 1 ? dueEmail.length + " reminders" : "Reminder"}: ${String(dueEmail[0].text).slice(0, 60)}`, html }),
    });
    const data = await res.json();
    if (res.ok) emailId = data.id; // if Resend hiccups we just retry next cron tick
  }

  // ---- mark what went out + persist (incl. pruned subs) ----
  notes.reminders = rems.map((r) => {
    let o = r;
    if (dueEmail.some((d) => d.id === r.id) && emailId) o = { ...o, emailed: true };
    // a "wave" is claimed when anything actually went out — the next wave comes NAG_MINUTES later
    if (dueWave.some((d) => d.id === r.id) && (pushedDevices > 0 || (r as any)._dmok)) o = { ...o, lastPing: new Date().toISOString(), pings: (o.pings || 0) + 1 };
    if ((r as any)._dmok) { o = { ...o, dmed: true }; delete (o as any)._dmok; }
    if ((r as any)._postok) { o = { ...o, posted: true, done: true }; delete (o as any)._postok; }   // client-channel reminder fired once → done
    return o;
  });
  await sb.from("daily_logs").upsert(
    { user_id: user, log_date: "2000-01-01", notes: JSON.stringify(notes), updated_at: new Date().toISOString() },
    { onConflict: "user_id,log_date" },
  );
  return { user, push: pushedDevices, email: emailId ? dueEmail.length : 0, dm: dmed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // GET → hand the front-end the VAPID public key (safe to expose; that's its job)
  if (req.method === "GET") return json({ publicKey: Deno.env.get("VAPID_PUBLIC_KEY") || "" });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);                                            // YYYY-MM-DD
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now); // HH:MM

    const results = [];
    for (const user of USERS) {
      try { results.push(await processUser(sb, user, today, hm)); }
      catch (e) { results.push({ user, error: String((e as Error)?.message || e) }); }
    }
    return json({ ok: true, results });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
