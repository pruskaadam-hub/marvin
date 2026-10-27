import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const source = await readFile(new URL("../supabase/functions/marvin-api/index.ts", import.meta.url), "utf8");
let handler, fetched, timeout, fetchError;
let authenticated = true;
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-test-key",
  marvin_allowed_emails: "pruskaadam@me.com", n8n_marvin_key: "server-only-test-secret",
  n8n_stav_url: "https://example.com/stav", n8n_prikaz_url: "https://example.com/prikaz" };
const script = stripTypeScriptTypes(source.replace(/^import .+;\n/, ""));
vm.runInNewContext(script, {
  Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { email: "pruskaadam@me.com", id: "adam" } : null }, error: null }) } }),
  Request, Response, URL, TextEncoder, Error, crypto,
  AbortSignal: { timeout: ms => { timeout = ms; return new AbortController().signal; } },
  fetch: async (url, options) => {
    fetched = { url, options };
    if (fetchError) throw fetchError;
    return Response.json({ ok: true, odpoved: "**Hotovo**" });
  },
});
function request(body, { method = "POST", auth = true, route = "chat", origin = "https://pruskaadam-hub.github.io" } = {}) {
  return new Request(`https://example.supabase.co/functions/v1/marvin-api/${route}`, {
    method, headers: { Origin: origin, ...(auth ? { Authorization: "Bearer user-session" } : {}), "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
const body = { text: "Ahoj", sessionId: "conversation-123" };
const ok = await handler(request(body));
assert.equal(ok.status, 200);
assert.deepEqual(await ok.json(), { ok: true, odpoved: "**Hotovo**" });
assert.equal(fetched.url, "https://cometx.app.n8n.cloud/webhook/marvin/chat");
assert.equal(fetched.options.headers["X-Marvin-Key"], env.n8n_marvin_key);
assert.equal(fetched.options.headers["Content-Type"], "application/json");
assert.deepEqual(JSON.parse(fetched.options.body), body);
assert.equal(timeout, 90000);
assert.equal((await handler(request(body, { auth: false }))).status, 401);
authenticated = false;
assert.equal((await handler(request(body))).status, 401);
authenticated = true;
for (const invalid of [null, [], {}, { ...body, text: " " }, { ...body, text: "x".repeat(12001) }, { ...body, sessionId: "bad" }]) {
  assert.equal((await handler(request(invalid))).status, 400);
}
assert.equal((await handler(request(body, { method: "GET" }))).status, 405);
assert.equal((await handler(request(body, { method: "OPTIONS", auth: false }))).status, 204);
assert.equal((await handler(request(body, { origin: "https://evil.example" }))).status, 403);
fetchError = Object.assign(new Error("slow"), { name: "TimeoutError" });
assert.equal((await handler(request(body))).status, 504);
fetchError = null;
assert.equal((await handler(request(null, { route: "stav", method: "GET" }))).status, 200);
assert.equal(fetched.url, env.n8n_stav_url);
assert.equal(timeout, 15000);
assert.equal((await handler(request({ typ: "poznamka", idempotency_key: "test-command-123", data: { text: "test" } }, { route: "prikaz" }))).status, 200);
assert.equal(fetched.url, env.n8n_prikaz_url);
console.log("MARVIN gateway: chat forwarding, authentication, validation, timeout and existing routes OK");
