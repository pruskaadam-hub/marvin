import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_ORIGIN = "https://pruskaadam-hub.github.io";
const MAX_BODY_BYTES = 65_536;

function csv(name: string, fallback = ""): string[] {
  return (Deno.env.get(name) ?? fallback).split(",").map((value) => value.trim()).filter(Boolean);
}

function cors(origin: string | null): HeadersInit {
  const allowed = csv("marvin_allowed_origins", DEFAULT_ORIGIN);
  return {
    ...(origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(status: number, body: unknown, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const headers = cors(origin);
  const allowedOrigins = csv("marvin_allowed_origins", DEFAULT_ORIGIN);

  if (request.method === "OPTIONS") {
    return origin && allowedOrigins.includes(origin) ? new Response(null, { status: 204, headers }) : json(403, { error: "Origin není povolen." }, headers);
  }
  if (!origin || !allowedOrigins.includes(origin)) return json(403, { error: "Origin není povolen." }, headers);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { error: "Chybí přihlášení." }, headers);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json(503, { error: "Supabase Auth není nakonfigurovaný." }, headers);

  const auth = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user?.email) return json(401, { error: "Přihlášení není platné." }, headers);

  const allowedEmails = csv("marvin_allowed_emails").map((email) => email.toLowerCase());
  if (!allowedEmails.length || !allowedEmails.includes(data.user.email.toLowerCase())) return json(403, { error: "Účet nemá přístup." }, headers);

  const secret = Deno.env.get("n8n_marvin_key");
  const statusUrl = Deno.env.get("n8n_stav_url");
  const commandUrl = Deno.env.get("n8n_prikaz_url");
  if (!secret || !statusUrl || !commandUrl) return json(503, { error: "Brána není dokončená." }, headers);

  const route = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  let upstreamUrl = "";
  let body: string | undefined;

  if (route === "stav") {
    if (request.method !== "GET") return json(405, { error: "Nepovolená metoda." }, headers);
    upstreamUrl = statusUrl;
  } else if (route === "prikaz") {
    if (request.method !== "POST") return json(405, { error: "Nepovolená metoda." }, headers);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) return json(413, { error: "Příkaz je příliš velký." }, headers);
    body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json(413, { error: "Příkaz je příliš velký." }, headers);
    let command: Record<string, unknown>;
    try { command = JSON.parse(body); } catch { return json(400, { error: "Neplatný JSON." }, headers); }
    if (typeof command.idempotency_key !== "string" || command.idempotency_key.length < 8 || command.idempotency_key.length > 200) return json(400, { error: "Neplatný idempotency_key." }, headers);
    if (typeof command.typ !== "string" || !/^[a-z0-9_-]{2,64}$/.test(command.typ)) return json(400, { error: "Neplatný typ příkazu." }, headers);
    if (command.data !== undefined && (typeof command.data !== "object" || command.data === null || Array.isArray(command.data))) return json(400, { error: "Pole data musí být objekt." }, headers);
    upstreamUrl = commandUrl;
  } else {
    return json(404, { error: "Neznámá cesta." }, headers);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: { "X-Marvin-Key": secret, "X-Marvin-User": data.user.id, "X-Request-Id": crypto.randomUUID(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const responseText = await upstream.text();
    return new Response(responseText, { status: upstream.status, headers: { ...headers, "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return json(502, { error: "n8n je dočasně nedostupné." }, headers);
  }
});
