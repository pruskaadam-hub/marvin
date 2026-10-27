import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
// Replace only the browser CDN import; run the real startup and rendering code.
const script = app.replace(/^import .+;\n/gm, "");

async function start({ payload = {}, status = 200, startupError = false } = {}) {
  const { document } = parseHTML(html);
  const session = { access_token: "test-session", user: { email: "pruskaadam@me.com" } };
  const client = { auth: {
    async getSession() {
      if (startupError) throw new Error("Testovací chyba přihlášení");
      return { data: { session } };
    },
    onAuthStateChange() {},
  } };
  await vm.runInNewContext(script, {
    document,
    window: { MARVIN_CONFIG: {
      supabaseUrl: "https://kmntccvrsuhndupswrig.supabase.co",
      supabasePublishableKey: "sb_publishable_test_key_for_rendering",
      edgeFunctionName: "marvin-api",
      allowedEmail: session.user.email,
    } },
    createClient: () => client,
    createChat: () => ({ setUser() {} }),
    fetch: async () => ({ ok: status === 200, status, json: async () => payload }),
  });
  return document;
}

const empty = await start();
assert.equal(empty.getElementById("appPanel").classList.contains("hidden"), false);
assert.equal(empty.getElementById("setupPanel").classList.contains("hidden"), true);
for (const id of ["timeline", "priorities", "tomorrow", "attention"]) {
  assert.match(empty.getElementById(id).textContent, /Nic zde teď nevyžaduje pozornost/);
}
assert.match(empty.getElementById("connectionBadge").textContent, /Připojeno/);

const failed = await start({ status: 503, payload: { error: "Brána není dokončená." } });
assert.equal(failed.getElementById("setupPanel").classList.contains("hidden"), true);
assert.equal(failed.getElementById("appPanel").classList.contains("hidden"), false);
assert.match(failed.getElementById("attention").textContent, /Brána není dokončená/);
assert.equal(failed.getElementById("refreshButton").disabled, false);

const startup = await start({ startupError: true });
assert.equal(startup.getElementById("setupPanel").classList.contains("hidden"), false);
assert.equal(startup.getElementById("setupTitle").textContent, "Panel se nepodařilo spustit");
assert.match(startup.getElementById("setupPanel").textContent, /Testovací chyba přihlášení/);
console.log("MARVIN rendering: empty data, API failure and startup failure OK");
