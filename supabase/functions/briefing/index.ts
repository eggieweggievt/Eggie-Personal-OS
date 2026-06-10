// =============================================================================
// Eggie OS — "briefing" Edge Function 🐙☀️
// Reads your OS each morning, writes a warm summary, emails it via Resend.
// Scheduled by Supabase Cron (daily). See EDGE-FUNCTION-SETUP.md.
//
// Secrets:  RESEND_API_KEY  (required)
//           BRIEFING_TO      (default: eggie@eggieweggie.ca)
//           BRIEFING_FROM    (default: "Eggie OS <onboarding@resend.dev>")
//           BRIEFING_USER_ID (default: eggie)
// Deploy:   supabase functions deploy briefing --no-verify-jwt
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseNotes, todayBits } from "../_shared/today.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const USER = Deno.env.get("BRIEFING_USER_ID") || "eggie";
const TO = Deno.env.get("BRIEFING_TO") || "eggie@eggieweggie.ca";
const FROM = Deno.env.get("BRIEFING_FROM") || "Eggie OS <onboarding@resend.dev>";

function esc(s: unknown){ return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]!)); }
const parse = parseNotes;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY secret is not set" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const now = new Date();
    const niceDate = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Toronto" });
    const monthKey = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-CA");
    const yKey = new Date(now.getTime() - 86400000).toLocaleDateString("en-CA");

    // content in flight (NOTE: no completed_at column exists — published stage is the "done" marker)
    const { data: content } = await sb.from("content_items").select("title,stage,priority,parent_id").eq("user_id", USER).order("priority", { ascending: false }).limit(50);
    const inFlight = (content || []).filter((c: any) => !c.parent_id && c.stage !== "published");
    const top = inFlight.slice(0, 3);

    // sentinel: goals + today's shape (stream slot etc.) via the SHARED builder — same code /today uses
    const { data: sent } = await sb.from("daily_logs").select("notes").eq("user_id", USER).eq("log_date", "2000-01-01").maybeSingle();
    const s = parse(sent?.notes ?? null);
    const goals = (s.goals_week_items || []).filter((g: any) => !g.done).slice(0, 3);
    const bits = todayBits(s);
    const todayStream = bits.slots;

    // yesterday habits — the app stores habits as {counts:{habitId:n}}, not a done[] array
    const { data: yday } = await sb.from("daily_logs").select("notes").eq("user_id", USER).eq("log_date", yKey).maybeSingle();
    const yCounts = parse(yday?.notes ?? null).habits?.counts || {};
    const yHabits = Object.values(yCounts).filter((v: any) => Number(v) > 0).length;

    // money this month
    const { data: inc } = await sb.from("income_entries").select("kind,amount").eq("user_id", USER).eq("month", monthKey).limit(1000);
    let mIn = 0, mOut = 0;
    (inc || []).forEach((e: any) => { (e.kind === "out" ? (mOut += Number(e.amount)) : (mIn += Number(e.amount))); });
    const net = mIn - mOut;

    const li = (t: string) => `<li style="margin:3px 0">${esc(t)}</li>`;
    const sectionsHtml = `
      <p style="margin:0 0 6px;color:#7c6a80">Good morning, Eggie 🐙 — here's your gentle plan for <b>${niceDate}</b>.</p>
      ${todayStream.length ? `<p style="margin:10px 0 4px"><b>🗓️ Streaming today:</b> ${todayStream.map((x: any) => `${esc(x.title || "Stream")}${x.time ? " (" + esc(x.time) + ")" : ""}`).join(" · ")}</p>` : `<p style="margin:10px 0 4px;color:#7c6a80">🌙 No stream scheduled today — a rest or batch day is allowed.</p>`}
      ${bits.events.length ? `<p style="margin:8px 0 4px"><b>📅 On the calendar:</b> ${bits.events.slice(0, 4).map((e: any) => `${esc(e.title)}${e.time ? " (" + esc(e.time) + ")" : ""}`).join(" · ")}</p>` : ""}
      ${bits.dueReminders.length ? `<p style="margin:8px 0 4px"><b>⏰ Gentle nudges waiting:</b> ${bits.dueReminders.slice(0, 4).map((r: any) => esc(r.text)).join(" · ")}</p>` : ""}
      <p style="margin:12px 0 4px"><b>🎬 In flight (${inFlight.length}):</b></p>
      <ul style="margin:0;padding-left:18px;color:#4a3a4d">${top.map((c: any) => li(`${c.title} — ${c.stage}`)).join("") || li("nothing queued — ideas welcome 🌸")}</ul>
      ${goals.length ? `<p style="margin:12px 0 4px"><b>🌷 Week goals left:</b></p><ul style="margin:0;padding-left:18px;color:#4a3a4d">${goals.map((g: any) => li(g.text)).join("")}</ul>` : ""}
      <p style="margin:12px 0 4px"><b>💗 Yesterday:</b> ${yHabits} habit${yHabits === 1 ? "" : "s"} done.${yHabits === 0 ? " A fresh start today. 🌸" : " Proud of you."}</p>
      <p style="margin:8px 0 4px"><b>💰 This month:</b> +$${mIn.toLocaleString()} in · −$${mOut.toLocaleString()} out · net ${net >= 0 ? "+" : "−"}$${Math.abs(net).toLocaleString()}</p>
      <p style="margin:16px 0 0;color:#7c6a80;font-size:13px">Take it one gentle thing at a time. A paused streak is still a streak. 💗</p>`;

    const html = `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #f0dcec;border-radius:16px;padding:22px;color:#4a3a4d">
      <div style="font-size:20px;font-weight:700;color:#db5e98;margin-bottom:6px">🐙 Eggie OS · morning briefing</div>
      ${sectionsHtml}
      <div style="margin-top:18px;text-align:center"><a href="https://${(Deno.env.get("BRIEFING_LINK") || "eggieweggievt.github.io/Eggie-Personal-OS/")}" style="color:#8d6fd1;font-size:12px">open Eggie OS →</a></div>
    </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [TO], subject: `☀️ Your Eggie OS briefing — ${niceDate}`, html }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: data?.message || "Resend error", detail: data }, 500);
    return json({ ok: true, id: data.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
