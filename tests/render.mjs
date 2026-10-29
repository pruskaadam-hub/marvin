import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { renderMarkdown } from "../chat.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
// Replace only the browser CDN import; run the real startup and rendering code.
const script = app.replace(/^import .+;\n/gm, "");

async function start({ payload = {}, status = 200, startupError = false, onFetch, onChat } = {}) {
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
    createChat: options => { onChat?.(options); return { setUser() {} }; },
    renderMarkdown,
    fetch: async (url) => { onFetch?.(url); return { ok: status === 200, status, json: async () => payload }; },
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

const noSummary = "Zatím žádný souhrn. Další přijde v 7:00, 12:00 nebo 17:00.";
for (const value of [undefined, null, {}, [], [null], [{}], "invalid", { souhrn: "  " }, { souhrn: 123 }]) {
  const doc = await start({ payload: { souhrn_emailu: value } });
  assert.equal(doc.getElementById("emailSummary").textContent, noSummary);
  assert.equal(doc.getElementById("emailSummaryToggle").classList.contains("hidden"), true);
  assert.equal(doc.getElementById("emailSummaryTime").textContent, "");
  assert.match(doc.getElementById("connectionBadge").textContent, /Připojeno/);
}

const summary = { souhrn: "**Důležité**\n- Odpovědět\n- Přečíst\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>", oblast: "E-maily 17:13", platne_k: "2026-10-29" };
for (const value of [summary, [summary, { souhrn: "Druhá položka" }]]) {
  const doc = await start({ payload: { data: { souhrn_emailu: value, ukoly: [
    { nazev: "Odpovědět", zdroj: "gmail" }, { nazev: "Zavolat", zdroj: "web" }, "Nakoupit",
  ] } } });
  const content = doc.getElementById("emailSummary");
  assert.equal(content.querySelector("strong").textContent, "Důležité");
  assert.equal(content.querySelectorAll("li").length, 2);
  assert.equal(content.querySelectorAll("img, script, [onerror]").length, 0);
  assert.match(content.textContent, /<script>/);
  assert.doesNotMatch(content.textContent, /Druhá položka/);
  assert.equal(doc.getElementById("emailSummaryTime").textContent, "29. 10. · 17:13");
  assert.equal(doc.querySelectorAll(".task-source").length, 1);
  assert.equal(doc.querySelector(".task-source").textContent, "z e-mailu");
  const toggle = doc.getElementById("emailSummaryToggle");
  toggle.click();
  assert.equal(toggle.textContent, "Skrýt");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(content.classList.contains("email-summary-collapsed"), false);
  toggle.click();
  assert.equal(toggle.textContent, "Zobrazit celé");
  assert.equal(content.classList.contains("email-summary-collapsed"), true);
}

for (const metadata of [{}, { platne_k: "2026-10-29" }, { oblast: "E-maily 17:13" }, { platne_k: {}, oblast: [] }]) {
  const doc = await start({ payload: { souhrn_emailu: { souhrn: "Souhrn", ...metadata } } });
  assert.equal(doc.getElementById("emailSummary").textContent, "Souhrn");
  assert.doesNotMatch(doc.getElementById("emailSummaryTime").textContent, /undefined|NaN|Invalid/);
}

const payload = { souhrn_emailu: summary };
const requests = [];
let refreshFromChat;
const refreshed = await start({ payload, onFetch: url => requests.push(url), onChat: options => { refreshFromChat = options.refresh; } });
payload.souhrn_emailu = { souhrn: "Aktualizováno ručně" };
refreshed.getElementById("refreshButton").click();
await new Promise(resolve => setImmediate(resolve));
assert.equal(refreshed.getElementById("emailSummary").textContent, "Aktualizováno ručně");
payload.souhrn_emailu = { souhrn: "Aktualizováno po chatu" };
await refreshFromChat();
assert.equal(refreshed.getElementById("emailSummary").textContent, "Aktualizováno po chatu");
delete payload.souhrn_emailu;
await refreshFromChat();
assert.equal(refreshed.getElementById("emailSummary").textContent, noSummary);
assert.equal(requests.length, 4);
assert.ok(requests.every(url => url.endsWith("/marvin-api/stav")));
console.log("MARVIN email summary: optional payloads, safe Markdown, metadata, badges and shared refresh OK");
