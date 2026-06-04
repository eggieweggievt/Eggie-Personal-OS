// avatar-skin — verified skin saver for the Stream Avatars picker page.
// Receives { token, skin }, asks Twitch who the token belongs to, then
// upserts avatar_skins with the service role. Nobody can spoof another
// viewer's skin because the user-id comes from Twitch, not the browser.
//
// Deploy (from the Eggie-Personal-OS folder):
//   supabase secrets set TWITCH_CLIENT_ID=your_client_id_from_dev.twitch.tv
//   supabase functions deploy avatar-skin --no-verify-jwt

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_SKINS = ["eggie", "grape", "sky", "mint", "honey", "cocoa"];

// gear is channel-defined (uploaded on setup.html), so validate shape not names:
// an object of {setName: pieceName} with short alphanumeric strings
function validGearShape(g: unknown): g is Record<string, string> {
  if (typeof g !== "object" || g === null || Array.isArray(g)) return false;
  const entries = Object.entries(g as Record<string, unknown>);
  if (entries.length > 8) return false;
  return entries.every(([k, v]) =>
    /^[a-z0-9_]{1,32}$/.test(k) && typeof v === "string" && /^[a-z0-9_]{1,32}$/.test(v));
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, skin, gear } = await req.json();
    if (typeof token !== "string" || !token) return json({ error: "missing token" }, 400);
    if (skin === undefined && gear === undefined) return json({ error: "nothing to save" }, 400);
    if (skin !== undefined && !ALLOWED_SKINS.includes(skin)) return json({ error: "unknown skin", allowed: ALLOWED_SKINS }, 400);
    if (gear !== undefined && !validGearShape(gear)) return json({ error: "bad gear format" }, 400);

    const clientId = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
    if (!clientId) return json({ error: "TWITCH_CLIENT_ID secret not set" }, 500);

    // verify the token really belongs to this viewer
    const tw = await fetch("https://api.twitch.tv/helix/users", {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
    });
    if (!tw.ok) return json({ error: "twitch token invalid or expired" }, 401);
    const user = (await tw.json()).data?.[0];
    if (!user?.id) return json({ error: "no twitch user for token" }, 401);

    // upsert with the service role (RLS-proof)
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const up = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/avatar_skins`, {
      method: "POST",
      headers: {
        apikey: svc,
        Authorization: `Bearer ${svc}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        twitch_user_id: user.id,
        ...(skin !== undefined ? { skin } : {}),
        ...(gear !== undefined ? { gear } : {}),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!up.ok) return json({ error: "db write failed", detail: await up.text() }, 500);

    return json({ ok: true, user: user.display_name, skin, gear });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
