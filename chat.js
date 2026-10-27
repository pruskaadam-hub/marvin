// Markdown is rendered exclusively with DOM nodes and textContent, never HTML.
export function renderMarkdown(document, text) {
  const fragment = document.createDocumentFragment();
  function inline(parent, value) {
    const tokens = /(\*\*([^\n]+?)\*\*|__([^\n]+?)__|`([^`\n]+)`)/g;
    let offset = 0;
    for (const match of value.matchAll(tokens)) {
      parent.append(document.createTextNode(value.slice(offset, match.index)));
      const node = document.createElement(match[4] !== undefined ? "code" : "strong");
      node.textContent = match[2] ?? match[3] ?? match[4];
      parent.append(node);
      offset = match.index + match[0].length;
    }
    parent.append(document.createTextNode(value.slice(offset)));
  }
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  let list = null;
  let paragraph = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { list = null; paragraph = null; continue; }
    if (/^```/.test(line)) {
      const code = document.createElement("code");
      const pre = document.createElement("pre");
      const content = [];
      while (++i < lines.length && !/^```/.test(lines[i])) content.push(lines[i]);
      code.textContent = content.join("\n");
      pre.append(code); fragment.append(pre); list = null; paragraph = null; continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(line);
    if (heading) {
      const node = document.createElement(`h${Math.min(heading[1].length + 1, 6)}`);
      inline(node, heading[2]); fragment.append(node); list = null; paragraph = null;
    } else if (bullet) {
      const type = bullet[1] ? "ul" : "ol";
      if (!list || list.localName !== type) { list = document.createElement(type); fragment.append(list); }
      const item = document.createElement("li"); inline(item, bullet[2]); list.append(item); paragraph = null;
    } else {
      list = null;
      if (!paragraph) { paragraph = document.createElement("p"); fragment.append(paragraph); }
      else paragraph.append(document.createElement("br"));
      inline(paragraph, line);
    }
  }
  return fragment;
}

export function createChat({ document, send, refresh, storage, randomUUID = () => crypto.randomUUID(),
  schedule = setTimeout, cancel = clearTimeout }) {
  const el = Object.fromEntries(["chatToggle", "marvinChat", "chatNew", "chatClose", "chatHistory", "chatStatus", "chatForm", "chatInput", "chatSend"].map(id => [id, document.getElementById(id)]));
  let user = null, record = null, busy = false, active = null, generation = 0;
  const key = () => `marvin.chat.v1:${user}`;
  function persist() {
    try { storage?.setItem(key(), JSON.stringify(record)); } catch { /* Chat remains usable without storage. */ }
  }
  function render() {
    el.chatHistory.replaceChildren();
    for (const message of record?.messages ?? []) {
      const row = document.createElement("article");
      row.className = `chat-message chat-${message.role}`;
      const label = document.createElement("strong"); label.className = "chat-author";
      label.textContent = message.role === "user" ? "Ty" : "MARVIN";
      const content = document.createElement("div");
      if (message.role === "assistant") content.append(renderMarkdown(document, message.text));
      else { content.className = "chat-user-text"; content.textContent = message.text; }
      row.append(label, content); el.chatHistory.append(row);
    }
    if (!record?.messages.length) {
      const empty = document.createElement("p"); empty.className = "empty-state";
      empty.textContent = "Napiš MARVINovi, s čím potřebuješ pomoci."; el.chatHistory.append(empty);
    }
    el.chatHistory.scrollTop = el.chatHistory.scrollHeight;
  }
  function setBusy(value) {
    busy = value;
    el.chatSend.disabled = value; el.chatNew.disabled = value; el.chatInput.disabled = value;
    el.chatForm.setAttribute("aria-busy", String(value));
  }
  function toggle(open) {
    el.marvinChat.classList.toggle("hidden", !open);
    el.chatToggle.setAttribute("aria-expanded", String(open));
    if (open) el.chatInput.focus(); else if (user) el.chatToggle.focus();
  }
  function setUser(next) {
    if (next === user) return;
    generation++; active?.abort(); active = null;
    user = next; record = null; setBusy(false); toggle(false);
    el.chatToggle.classList.toggle("hidden", !user);
    el.chatStatus.textContent = ""; el.chatInput.value = "";
    if (user) {
      try {
        const saved = JSON.parse(storage?.getItem(key()) ?? "null");
        if (saved && /^[a-zA-Z0-9_-]{8,200}$/.test(saved.sessionId) && Array.isArray(saved.messages)) {
          record = { sessionId: saved.sessionId, messages: saved.messages.filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.text === "string").slice(-100) };
        }
      } catch { /* An invalid stored record starts a new conversation. */ }
      if (!record) record = { sessionId: randomUUID(), messages: [] };
      persist();
    }
    render();
  }
  async function submit(event) {
    event?.preventDefault();
    const text = el.chatInput.value.trim();
    if (!user || busy || !text || text.length > 12000) return;
    const current = generation;
    const last = record.messages.at(-1);
    if (last?.role !== "user" || last.text !== text) record.messages.push({ role: "user", text });
    persist(); render(); setBusy(true);
    el.chatStatus.className = "chat-status";
    el.chatStatus.textContent = "MARVIN přemýšlí…";
    const controller = new AbortController(); active = controller;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = schedule(() => {
        reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
        controller.abort();
      }, 90_000);
    });
    try {
      const result = await Promise.race([send({ text, sessionId: record.sessionId }, controller.signal), timeout]);
      if (current !== generation) return;
      if (result?.ok !== true || typeof result.odpoved !== "string" || !result.odpoved.trim()) throw new Error("invalid_response");
      record.messages.push({ role: "assistant", text: result.odpoved });
      record.messages = record.messages.slice(-100);
      persist(); render(); el.chatInput.value = ""; el.chatStatus.textContent = "";
      // Refresh failure must not hide a successfully received chat answer.
      Promise.resolve().then(refresh).catch(() => {});
    } catch (error) {
      if (current !== generation) return;
      el.chatStatus.className = "chat-status error";
      el.chatStatus.textContent = [401, 403].includes(error.status)
        ? "Chybí nebo nesedí klíč – zkontroluj Nastavení"
        : error.name === "TimeoutError" || error.name === "AbortError" || error.status === 504
          ? "MARVIN neodpověděl do 90 sekund. Akce už mohla proběhnout; obnov panel a před opakováním ji zkontroluj. Zprávu můžeš odeslat znovu."
          : "Odpověď se nepodařilo získat. Zkontroluj připojení a zkus zprávu odeslat znovu.";
    } finally {
      cancel(timer);
      if (current === generation) { active = null; setBusy(false); if (!el.marvinChat.classList.contains("hidden")) el.chatInput.focus(); }
    }
  }
  el.chatToggle.addEventListener("click", () => toggle(el.marvinChat.classList.contains("hidden")));
  el.chatClose.addEventListener("click", () => toggle(false));
  el.marvinChat.addEventListener("keydown", event => { if (event.key === "Escape") toggle(false); });
  el.chatForm.addEventListener("submit", submit);
  el.chatInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
  });
  el.chatNew.addEventListener("click", () => {
    if (busy || !user) return;
    record = { sessionId: randomUUID(), messages: [] }; persist(); render();
    el.chatInput.value = ""; el.chatStatus.textContent = ""; el.chatInput.focus();
  });
  return { setUser };
}
