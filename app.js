import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";

const config = window.MARVIN_CONFIG ?? {};
const AREA_ORDER = ["CometX", "Lab On Card", "Konzultace", "Osobní"];
const els = Object.fromEntries(
  [
    "setupPanel", "loginPanel", "appPanel", "connectionBadge", "refreshButton", "signOutButton",
    "loginForm", "emailInput", "loginMessage", "todayLabel", "greeting", "briefing",
    "completenessBadge", "lastComplete", "taskCount", "areaGrid", "timeline", "priorities",
    "tomorrow", "attention", "noteForm", "noteText", "noteArea", "noteMessage",
  ].map((id) => [id, document.getElementById(id)]),
);

let supabase = null;
let currentSession = null;

function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl ?? "")
    && typeof config.supabasePublishableKey === "string"
    && config.supabasePublishableKey.length > 20;
}

function showOnly(panel) {
  [els.setupPanel, els.loginPanel, els.appPanel].forEach((item) => item.classList.toggle("hidden", item !== panel));
}

function setConnection(state, label) {
  els.connectionBadge.className = `status-pill status-${state}`;
  els.connectionBadge.lastElementChild.textContent = label;
}

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `form-message ${type}`.trim();
}

function escapeText(value) {
  return String(value ?? "").trim();
}

function pick(source, keys, fallback) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) return source[key];
  }
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTask(item) {
  if (typeof item === "string") return { title: item, area: "Osobní", meta: "" };
  return {
    title: escapeText(pick(item, ["nazev", "title", "text", "ukol"], "Neoznačený úkol")),
    area: escapeText(pick(item, ["oblast", "area", "projekt", "project"], "Osobní")),
    meta: escapeText(pick(item, ["termin", "plan_datum", "deadline", "meta"], "")),
    status: escapeText(pick(item, ["stav", "status"], "otevřeno")),
  };
}

function normalizeState(raw) {
  const payload = raw?.data && typeof raw.data === "object" ? raw.data : raw ?? {};
  const overview = pick(payload, ["denni_prehled", "denni-prehled", "dnes", "overview"], payload);
  const tasks = asArray(pick(payload, ["ukoly", "tasks"], pick(overview, ["ukoly", "tasks"], []))).map(normalizeTask);
  const openTasks = tasks.filter((task) => !/[hH]otovo|done|completed/.test(task.status));
  return {
    briefing: escapeText(pick(overview, ["briefing", "souhrn", "summary"], "Dnešní data jsou připravena.")),
    completeness: escapeText(pick(pick(overview, ["uplnost", "completeness"], {}), ["stav", "status"], pick(overview, ["stav_dat"], "neúplné"))).toLowerCase(),
    lastComplete: pick(pick(overview, ["uplnost", "completeness"], {}), ["posledni_kompletni_zpracovani", "last_complete"], pick(overview, ["posledni_kompletni_zpracovani"], null)),
    priorities: asArray(pick(overview, ["priority", "priorities"], [])).slice(0, 3),
    timeline: asArray(pick(overview, ["casova_osa", "timeline", "udalosti"], [])),
    tomorrow: asArray(pick(overview, ["zitra", "tomorrow"], [])),
    attention: asArray(pick(overview, ["pozornost", "attention", "chyby", "errors"], [])),
    tasks: openTasks,
  };
}

function formatDate(value, options) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeText(value);
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", ...options }).format(date);
}

function localToday() {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date());
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 11) return "Dobré ráno, Adame.";
  if (hour < 18) return "Dobré odpoledne, Adame.";
  return "Dobrý večer, Adame.";
}

function appendEmpty(container) {
  container.replaceChildren(els.emptyTemplate.content.cloneNode(true));
}

function renderTextList(container, items) {
  container.replaceChildren();
  if (!items.length) return appendEmpty(container);
  items.forEach((value) => {
    const item = typeof value === "string" ? { title: value } : value;
    const row = document.createElement("div");
    row.className = "compact-item";
    row.textContent = escapeText(pick(item, ["nazev", "title", "text", "ukol", "zprava"], "Položka"));
    const meta = escapeText(pick(item, ["cas", "time", "termin", "oblast", "area"], ""));
    if (meta) {
      const small = document.createElement("small");
      small.textContent = meta;
      row.appendChild(small);
    }
    container.appendChild(row);
  });
}

function renderAreas(tasks) {
  els.areaGrid.replaceChildren();
  const grouped = new Map(AREA_ORDER.map((area) => [area, []]));
  tasks.forEach((task) => {
    const match = AREA_ORDER.find((area) => task.area.toLocaleLowerCase("cs").includes(area.toLocaleLowerCase("cs"))) ?? "Osobní";
    grouped.get(match).push(task);
  });
  AREA_ORDER.forEach((area) => {
    const tasksInArea = grouped.get(area);
    const card = document.createElement("article");
    card.className = "area-card";
    const heading = document.createElement("h3");
    heading.append(document.createTextNode(area));
    const count = document.createElement("span");
    count.textContent = `${tasksInArea.length}`;
    heading.appendChild(count);
    card.appendChild(heading);
    const list = document.createElement("ul");
    list.className = "task-list";
    if (!tasksInArea.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "Bez otevřených úkolů";
      list.appendChild(empty);
    } else {
      tasksInArea.slice(0, 5).forEach((task) => {
        const li = document.createElement("li");
        li.className = "task-item";
        li.textContent = task.title;
        if (task.meta) {
          const meta = document.createElement("span");
          meta.className = "task-meta";
          meta.textContent = task.meta;
          li.appendChild(meta);
        }
        list.appendChild(li);
      });
    }
    card.appendChild(list);
    els.areaGrid.appendChild(card);
  });
  els.taskCount.textContent = `${tasks.length} otevřených`;
}

function renderTimeline(items) {
  els.timeline.replaceChildren();
  if (!items.length) return appendEmpty(els.timeline);
  items.forEach((value) => {
    const item = typeof value === "string" ? { title: value } : value;
    const row = document.createElement("div");
    row.className = "timeline-item";
    const time = document.createElement("span");
    time.className = "timeline-time";
    time.textContent = escapeText(pick(item, ["cas", "time", "start"], "—"));
    const title = document.createElement("span");
    title.className = "timeline-title";
    title.textContent = escapeText(pick(item, ["nazev", "title", "text"], "Událost"));
    const area = document.createElement("span");
    area.className = "timeline-area";
    area.textContent = escapeText(pick(item, ["oblast", "area", "zdroj"], "Kalendář"));
    row.append(time, title, area);
    els.timeline.appendChild(row);
  });
}

function renderPriorities(items) {
  els.priorities.replaceChildren();
  if (!items.length) return appendEmpty(els.priorities);
  items.forEach((value) => {
    const li = document.createElement("li");
    li.textContent = escapeText(typeof value === "string" ? value : pick(value, ["nazev", "title", "text"], "Priorita"));
    els.priorities.appendChild(li);
  });
}

function render(data) {
  els.todayLabel.textContent = localToday();
  els.greeting.textContent = greeting();
  els.briefing.textContent = data.briefing || "Bez nových změn.";
  const complete = data.completeness.includes("aktu") || data.completeness.includes("complete");
  const error = data.completeness.includes("chyba") || data.completeness.includes("error");
  els.completenessBadge.className = `data-badge ${error ? "data-error" : complete ? "data-current" : "data-incomplete"}`;
  els.completenessBadge.textContent = error ? "Chyba dat" : complete ? "Data aktuální" : "Data neúplná";
  els.lastComplete.textContent = `Poslední úplné zpracování: ${formatDate(data.lastComplete, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  renderAreas(data.tasks);
  renderTimeline(data.timeline);
  renderPriorities(data.priorities);
  renderTextList(els.tomorrow, data.tomorrow);
  renderTextList(els.attention, data.attention);
}

async function api(path, options = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Přihlášení vypršelo. Přihlas se znovu.");
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${config.edgeFunctionName}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `Požadavek selhal (${response.status}).`);
  return payload;
}

async function loadState() {
  els.refreshButton.disabled = true;
  setConnection("loading", "Obnovuji");
  try {
    const raw = await api("stav");
    render(normalizeState(raw));
    setConnection("current", "Připojeno");
  } catch (error) {
    setConnection("error", "Chyba");
    render(normalizeState({
      briefing: "Dnešní stav se nepodařilo načíst. Zkontroluj frontu pozornosti.",
      uplnost: { stav: "chyba" },
      attention: [error.message],
    }));
  } finally {
    els.refreshButton.disabled = false;
  }
}

async function signIn(event) {
  event.preventDefault();
  const email = els.emailInput.value.trim().toLowerCase();
  const allowed = String(config.allowedEmail ?? "").trim().toLowerCase();
  if (allowed && email !== allowed) {
    return setMessage(els.loginMessage, "Tato adresa nemá přístup k panelu.", "error");
  }
  const button = event.submitter;
  button.disabled = true;
  setMessage(els.loginMessage, "Odesílám přihlašovací odkaz…");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}${location.pathname}` },
  });
  button.disabled = false;
  setMessage(els.loginMessage, error ? error.message : "Odkaz je odeslaný. Otevři jej ve stejné prohlížeči.", error ? "error" : "success");
}

async function submitNote(event) {
  event.preventDefault();
  const text = els.noteText.value.trim();
  if (!text) return;
  const button = event.submitter;
  button.disabled = true;
  setMessage(els.noteMessage, "Zařazuji do fronty…");
  const fingerprint = `${els.noteArea.value}|${text}`;
  const pendingKey = `marvin:pending:${btoa(unescape(encodeURIComponent(fingerprint))).slice(0, 80)}`;
  let idempotencyKey = sessionStorage.getItem(pendingKey);
  if (!idempotencyKey) {
    idempotencyKey = `web-${crypto.randomUUID()}`;
    sessionStorage.setItem(pendingKey, idempotencyKey);
  }
  try {
    await api("prikaz", {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        typ: "poznamka",
        data: { text, oblast: els.noteArea.value || null, zdroj: "web-marvin" },
      }),
    });
    sessionStorage.removeItem(pendingKey);
    els.noteForm.reset();
    setMessage(els.noteMessage, "Poznámka je bezpečně zařazená ke zpracování.", "success");
  } catch (error) {
    setMessage(els.noteMessage, `${error.message} Při opakování použijeme stejný klíč a nevznikne duplicita.`, "error");
  } finally {
    button.disabled = false;
  }
}

async function applySession(session) {
  currentSession = session;
  const signedIn = Boolean(session?.user);
  els.signOutButton.classList.toggle("hidden", !signedIn);
  if (!signedIn) {
    els.emailInput.value = config.allowedEmail ?? "";
    setConnection("error", "Nepřihlášeno");
    showOnly(els.loginPanel);
    return;
  }
  const email = session.user.email?.toLowerCase();
  if (config.allowedEmail && email !== config.allowedEmail.toLowerCase()) {
    await supabase.auth.signOut();
    setMessage(els.loginMessage, "Tento účet nemá přístup.", "error");
    return;
  }
  showOnly(els.appPanel);
  await loadState();
}

async function boot() {
  if (!isConfigured()) {
    setConnection("error", "Chybí konfigurace");
    showOnly(els.setupPanel);
    return;
  }
  supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  });
  const { data } = await supabase.auth.getSession();
  await applySession(data.session);
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token === currentSession?.access_token) return;
    window.setTimeout(() => applySession(session), 0);
  });
}

els.loginForm.addEventListener("submit", signIn);
els.noteForm.addEventListener("submit", submitNote);
els.refreshButton.addEventListener("click", loadState);
els.signOutButton.addEventListener("click", async () => supabase?.auth.signOut());

boot().catch((error) => {
  setConnection("error", "Chyba startu");
  showOnly(els.setupPanel);
  els.setupPanel.querySelector("p:not(.eyebrow)").textContent = error.message;
});

