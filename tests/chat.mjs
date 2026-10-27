import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { createChat, renderMarkdown } from "../chat.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(send) {
  const { document, window } = parseHTML(html);
  const values = new Map();
  let timeout, uuid = 0, refreshes = 0;
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const options = { document, storage, send, refresh: () => { refreshes++; },
    randomUUID: () => `conversation-${++uuid}`, schedule: (fn, ms) => { assert.equal(ms, 90000); timeout = fn; return 1; }, cancel() {} };
  const chat = createChat(options);
  const el = id => document.getElementById(id);
  chat.setUser("adam");
  const submit = text => { el("chatInput").value = text; el("chatForm").dispatchEvent(new window.Event("submit", { cancelable: true })); };
  return { chat, el, submit, window, document, storage, values, options, expire: () => timeout(), refreshes: () => refreshes };
}

const { document } = parseHTML("<html><body></body></html>");
document.body.append(renderMarkdown(document, '# Přehled\n**Důležité**\n- první\n- druhý\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[odkaz](javascript:alert(1))'));
assert.equal(document.querySelector("h2").textContent, "Přehled");
assert.equal(document.querySelector("strong").textContent, "Důležité");
assert.equal(document.querySelectorAll("li").length, 2);
assert.equal(document.querySelectorAll("img, script, a, [onerror]").length, 0);
assert.match(document.body.textContent, /<img/);

let resolve, sent, calls = 0;
const ok = setup((body, signal) => { calls++; sent = { body, signal }; return new Promise(r => { resolve = r; }); });
ok.el("chatToggle").click();
assert.equal(ok.el("marvinChat").classList.contains("hidden"), false);
ok.submit("První zpráva");
assert.equal(ok.el("chatStatus").textContent, "MARVIN přemýšlí…");
assert.equal(ok.el("chatSend").disabled, true);
assert.equal(ok.el("chatNew").disabled, true);
ok.submit("Druhá zpráva");
assert.equal(calls, 1);
assert.deepEqual(sent.body, { text: "První zpráva", sessionId: "conversation-1" });
resolve({ ok: true, odpoved: "## Odpověď\n**Hotovo**\n- úkol" });
await tick();
assert.equal(ok.el("chatSend").disabled, false);
assert.equal(ok.el("chatHistory").querySelector("h3").textContent, "Odpověď");
assert.equal(ok.refreshes(), 1);
const saved = JSON.parse(ok.storage.getItem("marvin.chat.v1:adam"));
assert.equal(saved.messages.length, 2);
const restoredDOM = parseHTML(html);
const restored = createChat({ ...ok.options, document: restoredDOM.document });
restored.setUser("adam");
assert.match(restoredDOM.document.getElementById("chatHistory").textContent, /První zpráva/);
assert.equal(JSON.parse(ok.storage.getItem("marvin.chat.v1:adam")).sessionId, saved.sessionId);
ok.el("chatNew").click();
assert.notEqual(JSON.parse(ok.storage.getItem("marvin.chat.v1:adam")).sessionId, saved.sessionId);
assert.equal(ok.el("chatHistory").querySelectorAll("article").length, 0);

for (const status of [401, 403, 500]) {
  const fail = setup(async () => { throw Object.assign(new Error("failed"), { status }); });
  fail.submit("Zkusit znovu"); await tick();
  assert.match(fail.el("chatStatus").textContent, status < 500 ? /Chybí nebo nesedí klíč – zkontroluj Nastavení/ : /zkus zprávu odeslat znovu/);
  assert.equal(fail.el("chatInput").value, "Zkusit znovu");
  assert.equal(fail.el("chatSend").disabled, false);
  fail.submit("Zkusit znovu"); await tick();
  assert.equal(fail.el("chatHistory").querySelectorAll("article").length, 1);
}
const invalid = setup(async () => ({ ok: true }));
invalid.submit("Ahoj"); await tick();
assert.match(invalid.el("chatStatus").textContent, /nepodařilo/);
assert.equal(invalid.refreshes(), 0);
let timeoutSignal;
const timed = setup((_, signal) => { timeoutSignal = signal; return new Promise(() => {}); });
timed.submit("Pomalá odpověď"); timed.expire(); await tick();
assert.equal(timeoutSignal.aborted, true);
assert.match(timed.el("chatStatus").textContent, /90 sekund/);
assert.equal(timed.el("chatSend").disabled, false);
let late;
const logout = setup(() => new Promise(r => { late = r; }));
logout.submit("Soukromá zpráva"); logout.chat.setUser(null);
late({ ok: true, odpoved: "Opožděná odpověď" }); await tick();
assert.equal(logout.el("chatToggle").classList.contains("hidden"), true);
assert.doesNotMatch(logout.el("chatHistory").textContent, /Soukromá|Opožděná/);

let keyboardCalls = 0;
const keyboard = setup(async () => { keyboardCalls++; return { ok: true, odpoved: "OK" }; });
keyboard.el("chatInput").value = "Enter";
function key(shiftKey, isComposing = false) {
  const event = new keyboard.window.Event("keydown", { cancelable: true });
  Object.assign(event, { key: "Enter", shiftKey, isComposing });
  keyboard.el("chatInput").dispatchEvent(event);
}
key(true); key(false, true); assert.equal(keyboardCalls, 0);
key(false); await tick(); assert.equal(keyboardCalls, 1);
console.log("MARVIN chat: Markdown safety, history, session, errors, timeout, retry, logout and Enter OK");
