import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { renderMarkdown } from "../chat.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
// Replace only the browser CDN import; run the real startup and rendering code.
const script = app.replace(/^import .+;\n/gm, "");

async function start({ payload = {}, status = 200, startupError = false, onFetch, onChat, fetchHandler, hash = "" } = {}) {
  const { document } = parseHTML(html);
  const pageLocation = { hash };
  let routeChanged;
  document.navigate = hash => { pageLocation.hash = hash; routeChanged?.(); };
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
    window: { location: pageLocation, addEventListener: (name, callback) => { if (name === "hashchange") routeChanged = callback; }, MARVIN_CONFIG: {
      supabaseUrl: "https://kmntccvrsuhndupswrig.supabase.co",
      supabasePublishableKey: "sb_publishable_test_key_for_rendering",
      edgeFunctionName: "marvin-api",
      allowedEmail: session.user.email,
    } },
    createClient: () => client,
    createChat: options => { onChat?.(options); return { setUser() {} }; },
    renderMarkdown,
    fetch: async (url, options) => {
      onFetch?.(url, options);
      if (fetchHandler) return fetchHandler(url, options);
      const body = url.includes("/ukoly?") ? { ukoly: payload.data?.ukoly ?? payload.ukoly ?? [], nextOffset: null } : payload;
      return { ok: status === 200, status, json: async () => body };
    },
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
  assert.equal(doc.getElementById("areaGrid").querySelectorAll(".task-source").length, 1);
  assert.equal(doc.getElementById("areaGrid").querySelector(".task-source").textContent, "z e-mailu");
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
assert.equal(requests.length, 8);
assert.equal(requests.filter(url => url.endsWith("/marvin-api/stav")).length, 4);
assert.equal(requests.filter(url => url.endsWith("/marvin-api/ukoly?offset=0")).length, 4);
console.log("MARVIN email summary: optional payloads, safe Markdown, metadata, badges and shared refresh OK");

const tick = () => new Promise(resolve => setImmediate(resolve));
let taskRows = Array.from({ length: 12 }, (_, i) => ({
  id: "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
  nazev: i === 0 ? "<img src=x onerror=alert(1)>" : "Úkol " + (i + 1),
  stav: i === 11 ? "hotovo" : "novy", oblast: "Osobní", zdroj: i === 0 ? "gmail" : "chat",
}));
let writes = 0, rejectWrite = false, unconfirmed = false;
const taskDoc = await start({ hash: "#ukoly", fetchHandler: async (url, options) => {
  if (url.endsWith("/ukol-hotovo")) {
    writes++;
    assert.equal(options.method, "POST");
    assert.match(options.headers.Authorization, /^Bearer /);
    const command = JSON.parse(options.body);
    assert.deepEqual(Object.keys(command), ["id"]);
    if (rejectWrite) return { ok: false, status: 503, json: async () => ({ error: "Test zápisu" }) };
    if (unconfirmed) return { ok: true, json: async () => ({ ok: true }) };
    taskRows = taskRows.map(row => row.id === command.id ? { ...row, stav: "hotovo" } : row);
    return { ok: true, json: async () => ({ ok: true, ukol: { id: command.id, stav: "hotovo" } }) };
  }
  return { ok: true, json: async () => url.includes("/ukoly?") ? { ukoly: taskRows, nextOffset: null } : {} };
} });
assert.equal(taskDoc.getElementById("homeView").classList.contains("hidden"), true);
assert.equal(taskDoc.getElementById("tasksView").classList.contains("hidden"), false);
assert.equal(taskDoc.querySelectorAll("#allTasks .all-task").length, 12);
assert.equal(taskDoc.querySelectorAll("#areaGrid .task-item").length, 5);
assert.equal(taskDoc.querySelectorAll("#allTasks img").length, 0);
assert.equal(taskDoc.querySelectorAll("#allTasks .task-done:disabled").length, 1);
assert.equal(taskDoc.getElementById("taskCount").textContent, "11 otevřených");
const done = taskDoc.querySelector("#allTasks .task-done");
done.click(); done.click();
assert.equal(taskDoc.querySelector("#allTasks .task-done").disabled, true);
await tick();
assert.equal(writes, 1);
assert.equal(taskRows[0].stav, "hotovo");
assert.equal(taskDoc.getElementById("taskCount").textContent, "10 otevřených");
assert.equal(taskDoc.querySelectorAll("#allTasks .all-task").length, 12);
assert.equal(taskDoc.querySelector("#allTasks .task-done").disabled, true);
assert.match(taskDoc.getElementById("tasksMessage").textContent, /označený jako hotový/);
taskDoc.navigate("#prehled");
assert.equal(taskDoc.getElementById("homeView").classList.contains("hidden"), false);
assert.equal(taskDoc.getElementById("tasksView").classList.contains("hidden"), true);
rejectWrite = true;
taskDoc.querySelectorAll("#allTasks .task-done")[1].click();
await tick();
assert.equal(taskRows[1].stav, "novy");
assert.equal(taskDoc.querySelectorAll("#allTasks .task-done")[1].disabled, false);
assert.match(taskDoc.getElementById("tasksMessage").textContent, /Test zápisu/);
rejectWrite = false; unconfirmed = true;
taskDoc.querySelectorAll("#allTasks .task-done")[1].click();
await tick();
assert.equal(taskRows[1].stav, "novy");
assert.match(taskDoc.getElementById("tasksMessage").textContent, /Server nepotvrdil/);
unconfirmed = false;
taskDoc.querySelectorAll("#areaGrid .task-done")[0].click();
await tick();
assert.equal(taskRows[1].stav, "hotovo");
assert.equal(taskDoc.getElementById("taskCount").textContent, "9 otevřených");
const offsets = [];
const paginated = await start({ fetchHandler: async url => {
  if (url.includes("/ukoly?")) {
    const offset = Number(new URL(url).searchParams.get("offset")); offsets.push(offset);
    return { ok: true, json: async () => ({ ukoly: offset === 0 ? taskRows.slice(0, 8) : taskRows.slice(8), nextOffset: offset === 0 ? 8 : null }) };
  }
  return { ok: true, json: async () => ({}) };
} });
assert.deepEqual(offsets, [0, 8]);
assert.equal(paginated.querySelectorAll("#allTasks .all-task").length, 12);
console.log("MARVIN tasks: all rows, separate route, safe text, completion, duplicate clicks, errors, retry and pagination OK");
