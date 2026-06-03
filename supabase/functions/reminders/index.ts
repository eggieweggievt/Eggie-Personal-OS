// =============================================================================
// Eggie OS — "reminders" Edge Function ⏰🐙
// Cron-driven (every ~5 min). Reads the sentinel row's reminders list and, for
// any that are due: sends a WEB PUSH to every subscribed device + an email via
// Resend. GET requests return the VAPID public key so the front-end can
// subscribe devices without any key pasted into the code.
//
// Secrets:  RESEND_API_KEY  (email)
//           VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY  (web push — from `npx web-push generate-vapid-keys`)
//           BRIEFING_TO / BRIEFING_FROM / BRIEFING_USER_ID / BRIEFING_LINK (shared with briefing)
// Deploy:   supabase functions deploy reminders --no-verify-jwt
// Cron:     */5 * * * *  → invoke "reminders", body {}
// Times are interpreted in America/Toronto (Eggie's clock).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const USER = Deno.env.get("BRIEFING_USER_ID") || "eggie";
const TO = Deno.env.get("BRIEFING_TO") || "eggie@eggieweggie.ca";
const FROM = Deno.env.get("BRIEFING_FROM") || "Eggie OS <onboarding@resend.dev>";
const TZ = "America/Toronto";

function esc(s: unknown) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // GET → hand the front-end the VAPID public key (safe to expose; that's its job)
  if (req.method === "GET") return json({ publicKey: Deno.env.get("VAPID_PUBLIC_KEY") || "" });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);                                            // YYYY-MM-DD
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now); // HH:MM

    const { data: sent } = await sb.from("daily_logs").select("notes").eq("user_id", USER).eq("log_date", "2000-01-01").maybeSingle();
    let notes: any = {}; try { notes = sent?.notes ? JSON.parse(sent.notes) : {}; } catch { notes = {}; }
    const rems: any[] = notes.reminders || [];

    const isDue = (r: any) => !r.done && (r.date < today || (r.date === today && (r.time || "09:00") <= hm));
    const duePush = rems.filter((r) => isDue(r) && !r.pushed);
    const dueEmail = rems.filter((r) => isDue(r) && !r.emailed && r.email !== false);
    if (!duePush.length && !dueEmail.length) return json({ ok: true, push: 0, email: 0 });

    // ---- web push to every subscribed device ----
    let pushedDevices = 0;
    const VPUB = Deno.env.get("VAPID_PUBLIC_KEY"), VPRIV = Deno.env.get("VAPID_PRIVATE_KEY");
    if (duePush.length && VPUB && VPRIV && Array.isArray(notes.pushSubs) && notes.pushSubs.length) {
      webpush.setVapidDetails("mailto:" + TO, VPUB, VPRIV);
      const payload = JSON.stringify({
        title: duePush.length > 1 ? `⏰ ${duePush.length} reminders` : "⏰ Eugene reminder",
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
    if (dueEmail.length && key) {
      const li = (r: any) => `<li style="margin:5px 0;font-size:15px"><b>${esc(r.text)}</b> <span style="color:#9b8aa0;font-size:12px">(${esc(r.date)}${r.time ? " · " + esc(r.time) : ""})</span></li>`;
      const html = `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #f0dcec;border-radius:16px;padding:22px;color:#4a3a4d">
        <div style="font-size:20px;font-weight:700;color:#db5e98;margin-bottom:6px">⏰ Eugene here — gentle nudge${dueEmail.length > 1 ? "s" : ""}!</div>
        <ul style="margin:8px 0;padding-left:18px">${dueEmail.map(li).join("")}</ul>
        <p style="margin:14px 0 0;color:#7c6a80;font-size:13px">No pressure, no guilt — this is just so it doesn't slip. You've got this. 🐙💗</p>
      </div>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [TO], subject: `⏰ ${dueEmail.length > 1 ? dueEmail.length + " reminders" : "Reminder"}: ${String(dueEmail[0].text).slice(0, 60)}`, html }),
      });
      const data = await res.json();
      if (res.ok) emailId = data.id; // if Resend hiccups we just retry next cron tick (emailed stays false)
    }

    // ---- mark what went out + persist (incl. pruned subs) ----
    notes.reminders = rems.map((r) => {
      let o = r;
      if (duePush.some((d) => d.id === r.id) && pushedDevices > 0) o = { ...o, pushed: true };
      if (dueEmail.some((d) => d.id === r.id) && emailId) o = { ...o, emailed: true };
      return o;
    });
    await sb.from("daily_logs").upsert(
      { user_id: USER, log_date: "2000-01-01", notes: JSON.stringify(notes), updated_at: new Date().toISOString() },
      { onConflict: "user_id,log_date" },
    );
    return json({ ok: true, push: pushedDevices, email: emailId ? dueEmail.length : 0 });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
