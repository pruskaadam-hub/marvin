import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const source = await readFile(new URL("../supabase/functions/marvin-api/index.ts", import.meta.url), "utf8");
let handler, fetched, timeout, fetchError;
let authenticated = true;
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-db-test-key",
  marvin_allowed_emails: "pruskaadam@me.com", n8n_marvin_key: "server-only-test-secret",
  n8n_stav_url: "https://example.com/stav", n8n_prikaz_url: "https://example.com/prikaz" };

const taskId = "00000000-0000-4000-8000-000000000001";
let task = { id: taskId, stav: "novy", revize: 4, archivovano: null };
let dbError = null, conflict = false, updates = 0, lastUpdate, lastFilters, lastRange;
let listedTasks = [task];
const db = { from(table) {
  assert.equal(table, "ukoly");
  const filters = [];
  let write;
  const query = {
    select() { return query; },
    order() { return query; },
    range(start, end) { lastRange = [start, end]; return query; },
    abortSignal() { return query; },
    eq(key, value) { filters.push([key, value]); return query; },
    is(key, value) { filters.push([key, value]); return query; },
    update(value) { write = value; return query; },
    async maybeSingle() {
      if (dbError) return { error: dbError, data: null };
      const found = task && filters.some(([key, value]) => key === "id" && value === task.id);
      if (!write) return { data: found ? { ...task } : null, error: null };
      updates++; lastUpdate = write; lastFilters = filters;
      if (!found || conflict) return { data: null, error: null };
      task = { ...task, ...write };
      return { data: { ...task }, error: null };
    },
    then(resolve, reject) { return Promise.resolve({ data: listedTasks, error: dbError }).then(resolve, reject); },
  };
  return query;
} };

const script = stripTypeScriptTypes(source.replace(/^import .+;\n/, ""));
vm.runInNewContext(script, {
  Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
  createClient: (_url, key, options) => key === env.SUPABASE_SERVICE_ROLE_KEY ? (assert.equal(options.global, undefined), db) : ({ auth: { getUser: async () => ({ data: { user: authenticated ? { email: "pruskaadam@me.com", id: "adam" } : null }, error: null }) } }),
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

fetched = null;
assert.equal((await handler(request(null, { route: "ukoly", method: "GET", auth: false }))).status, 401);
authenticated = false;
assert.equal((await handler(request({ id: taskId }, { route: "ukol-hotovo" }))).status, 401);
authenticated = true;
const allowedEmail = env.marvin_allowed_emails;
env.marvin_allowed_emails = "someone-else@example.com";
assert.equal((await handler(request(null, { route: "ukoly", method: "GET" }))).status, 403);
assert.equal((await handler(request({ id: taskId }, { route: "ukol-hotovo" }))).status, 403);
env.marvin_allowed_emails = allowedEmail;
const listing = await handler(request(null, { route: "ukoly?offset=200", method: "GET" }));
assert.equal(listing.status, 200);
assert.deepEqual((await listing.json()).ukoly, [task]);
assert.deepEqual(lastRange, [200, 399]);
assert.equal(fetched, null);
listedTasks = Array(200).fill(task);
assert.equal((await (await handler(request(null, { route: "ukoly", method: "GET" }))).json()).nextOffset, 200);
listedTasks = [task];
assert.equal((await handler(request(null, { route: "ukoly?offset=-1", method: "GET" }))).status, 400);
assert.equal((await handler(request(null, { route: "ukoly" }))).status, 405);
assert.equal((await handler(request(null, { route: "ukol-hotovo", method: "GET" }))).status, 405);
for (const invalid of [null, [], {}, { id: "bad" }, { id: 42 }]) {
  assert.equal((await handler(request(invalid, { route: "ukol-hotovo" }))).status, 400);
}
assert.equal((await handler(request({ id: taskId, extra: "x".repeat(1100) }, { route: "ukol-hotovo" }))).status, 413);
assert.equal(updates, 0);
const completed = await handler(request({ id: taskId, stav: "novy" }, { route: "ukol-hotovo" }));
assert.equal(completed.status, 200);
assert.equal((await completed.json()).ukol.stav, "hotovo");
assert.equal(lastUpdate.stav, "hotovo");
assert.equal(lastUpdate.revize, 5);
assert.ok(Number.isFinite(Date.parse(lastUpdate.upraveno)));
assert.deepEqual(lastFilters, [["id", taskId], ["revize", 4], ["stav", "novy"], ["archivovano", null]]);
assert.equal(updates, 1);
assert.equal((await handler(request({ id: taskId }, { route: "ukol-hotovo" }))).status, 200);
assert.equal(updates, 1, "Repeated completion must not write again");
task.stav = "novy"; conflict = true;
assert.equal((await handler(request({ id: taskId }, { route: "ukol-hotovo" }))).status, 409);
conflict = false; task.stav = "zruseno";
assert.equal((await handler(request({ id: taskId }, { route: "ukol-hotovo" }))).status, 409);
task.stav = "novy"; task.archivovano = "2026-10-29T00:00:00Z";
assert.equal((await handler(request({ id: taskId }, { route: "ukol-hotovo" }))).status, 409);
task = null;
assert.equal((await handler(request({ id: taskId }, { route: "ukol-hotovo" }))).status, 404);
dbError = { message: "database detail must stay server-side" };
const failedWrite = await handler(request({ id: taskId }, { route: "ukol-hotovo" }));
assert.equal(failedWrite.status, 502);
assert.doesNotMatch(await failedWrite.text(), /database detail/);
dbError = null;
console.log("MARVIN task gateway: allowlist, methods, pagination, exact ID, persistence, revision conflict, idempotency and errors OK");
