// =============================================================================
// Eggie OS — "reminders" Edge Function ⏰🐙
// Runs on a Supabase Cron schedule (every ~10 min). Reads the sentinel row's
// reminders list, emails any that are due via Resend, marks them emailed.
//
// Secrets (shared with briefing):  RESEND_API_KEY (required)
//   BRIEFING_TO (default eggie@eggieweggie.ca) · BRIEFING_FROM · BRIEFING_USER_ID
// Deploy:  supabase functions deploy reminders --no-verify-jwt
// Cron (dashboard → Integrations → Cron):  */10 * * * *   → invoke "reminders", body {}
// Times are interpreted in America/Toronto (Eggie's clock).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const USER = Deno.env.get("BRIEFING_USER_ID") || "eggie";
const TO = Deno.env.get("BRIEFING_TO") || "eggie@eggieweggie.ca";
const FROM = Deno.env.get("BRIEFING_FROM") || "Eggie OS <onboarding@resend.dev>";
const TZ = "America/Toronto";

function esc(s: unknown) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY secret is not set" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);                                            // YYYY-MM-DD
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now); // HH:MM

    const { data: sent } = await sb.from("daily_logs").select("notes").eq("user_id", USER).eq("log_date", "2000-01-01").maybeSingle();
    let notes: any = {}; try { notes = sent?.notes ? JSON.parse(sent.notes) : {}; } catch { notes = {}; }
    const rems: any[] = notes.reminders || [];

    const due = rems.filter((r) => !r.done && !r.emailed && r.email !== false && (r.date < today || (r.date === today && (r.time || "09:00") <= hm)));
    if (!due.length) return json({ ok: true, due: 0 });

    const li = (r: any) => `<li style="margin:5px 0;font-size:15px"><b>${esc(r.text)}</b> <span style="color:#9b8aa0;font-size:12px">(${esc(r.date)}${r.time ? " · " + esc(r.time) : ""})</span></li>`;
    const html = `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #f0dcec;border-radius:16px;padding:22px;color:#4a3a4d">
      <div style="font-size:20px;font-weight:700;color:#db5e98;margin-bottom:6px">⏰ Eugene here — gentle nudge${due.length > 1 ? "s" : ""}!</div>
      <ul style="margin:8px 0;padding-left:18px">${due.map(li).join("")}</ul>
      <p style="margin:14px 0 0;color:#7c6a80;font-size:13px">No pressure, no guilt — this is just so it doesn't slip. You've got this. 🐙💗</p>
    </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [TO], subject: `⏰ ${due.length > 1 ? due.length + " reminders" : "Reminder"}: ${String(due[0].text).slice(0, 60)}`, html }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: data?.message || "Resend error", detail: data }, 500);

    notes.reminders = rems.map((r) => (due.some((d) => d.id === r.id) ? { ...r, emailed: true } : r));
    await sb.from("daily_logs").upsert(
      { user_id: USER, log_date: "2000-01-01", notes: JSON.stringify(notes), updated_at: new Date().toISOString() },
      { onConflict: "user_id,log_date" },
    );
    return json({ ok: true, due: due.length, emailId: data.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
