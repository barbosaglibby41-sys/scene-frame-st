var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// core/tag-parser.js
var DEFAULT_IMAGE_RULES = Object.freeze([
  { id: "marker-image-hash", name: "image### \u56FE\u7247\u5757", enabled: true, mode: "markers", start: "image###", end: "###" },
  { id: "marker-image-tag", name: "<image> \u56FE\u7247\u5757\uFF08\u517C\u5BB9\uFF09", enabled: true, mode: "markers", start: "<image>", end: "</image>" }
]);
var escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var safeFlags = (value) => [...new Set(String(value || "").replace(/[^gimsu]/g, "") + "g")].join("");
function normalizeRules(rules) {
  const source = Array.isArray(rules) && rules.length ? rules : DEFAULT_IMAGE_RULES;
  return source.filter((rule) => rule && rule.enabled !== false).map((rule) => ({ ...rule, mode: rule.mode === "regex" ? "regex" : "markers" }));
}
function extractByRules(text = "", rules = DEFAULT_IMAGE_RULES) {
  const input = String(text);
  const blocks = [];
  const used = /* @__PURE__ */ new Set();
  for (const rule of normalizeRules(rules)) {
    try {
      const regex = rule.mode === "regex" ? new RegExp(rule.pattern || "", safeFlags(rule.flags)) : new RegExp(`${escapeRegex(rule.start || "")}([\\s\\S]*?)${escapeRegex(rule.end || "")}`, "gi");
      if (!regex.source || regex.source === "(?:)") continue;
      let match;
      let guard = 0;
      while ((match = regex.exec(input)) && guard++ < 30) {
        const raw = String(match[1] ?? "").trim();
        const key = `${match.index}:${raw}`;
        if (raw && !used.has(key)) {
          used.add(key);
          blocks.push({ raw, matched: match[0], index: blocks.length, offset: match.index, ruleId: rule.id, ruleName: rule.name });
        }
        if (match[0] === "") regex.lastIndex++;
      }
    } catch (error) {
      console.debug("[SceneFrame] invalid parser rule", rule.name, error);
    }
  }
  return blocks.sort((a, b) => a.offset - b.offset).map((block, index) => ({ ...block, index }));
}
function normalizePrompt(prompt = "") {
  return String(prompt).replace(/[，、；：]/g, ",").replace(/[；;]/g, ",").split(",").map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
}
async function digest(text) {
  const data = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// core/task-queue.js
var _TaskQueue_instances, pump_fn;
var TaskQueue = class {
  constructor({ concurrency = 1, onChange = () => {
  } } = {}) {
    __privateAdd(this, _TaskQueue_instances);
    this.concurrency = concurrency;
    this.onChange = onChange;
    this.items = [];
    this.running = 0;
  }
  add(task) {
    if (this.items.some((x) => x.hash === task.hash && !["failed", "cancelled"].includes(x.status))) return null;
    const item = { ...task, status: "queued", createdAt: Date.now() };
    this.items.push(item);
    this.onChange(this.items);
    __privateMethod(this, _TaskQueue_instances, pump_fn).call(this);
    return item;
  }
  cancel(id) {
    const item = this.items.find((x) => x.id === id && x.status === "queued");
    if (item) {
      item.status = "cancelled";
      this.onChange(this.items);
    }
  }
};
_TaskQueue_instances = new WeakSet();
pump_fn = async function() {
  while (this.running < this.concurrency) {
    const item = this.items.find((x) => x.status === "queued");
    if (!item) return;
    this.running++;
    item.status = "generating";
    this.onChange(this.items);
    try {
      item.result = await item.run(item);
      item.status = "completed";
    } catch (error) {
      item.error = String(error?.message || error);
      item.status = "failed";
    } finally {
      this.running--;
      this.onChange(this.items);
    }
  }
};

// adapters/nai.js
async function generateNAI({ apiKey, baseUrl = "https://image.novelai.net", model = "nai-diffusion-4-5-full", prompt, negativePrompt = "", width = 832, height = 1216, steps = 28, scale = 5, sampler = "k_euler", seed = -1, nSamples = 1, ucPreset = 2, qualityToggle = true, smea = false, smeaDyn = false }) {
  if (!apiKey) throw new Error("\u672A\u914D\u7F6E NovelAI API Key");
  const url = `${baseUrl.replace(/\/$/, "")}/ai/generate-image`;
  const body = { input: prompt, model, action: "generate", parameters: { width, height, scale, sampler, steps, seed, n_samples: nSamples, ucPreset, qualityToggle, sm: smea, sm_dyn: smeaDyn, negative_prompt: negativePrompt } };
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`NovelAI HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return { blob: await res.blob(), backend: "nai", prompt };
}

// adapters/sd-webui.js
async function generateSD({ baseUrl = "http://127.0.0.1:7860", prompt, negativePrompt = "", width = 768, height = 1024, steps = 28, cfgScale = 7, samplerName = "Euler a", seed = -1, model }) {
  const url = `${baseUrl.replace(/\/$/, "")}/sdapi/v1/txt2img`;
  const body = { prompt, negative_prompt: negativePrompt, width, height, steps, cfg_scale: cfgScale, sampler_name: samplerName, seed };
  if (model) body.override_settings = { sd_model_checkpoint: model };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`A1111 HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  if (!data.images?.[0]) throw new Error("A1111 \u672A\u8FD4\u56DE\u56FE\u7247");
  const raw = data.images[0].replace(/^data:image\/[^;]+;base64,/, "");
  const bin = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return { blob: new Blob([bin], { type: "image/png" }), backend: "sd", prompt, info: data.info };
}

// adapters/danbooru.js
var BASE_URL = "https://danbooru.donmai.us";
function cleanBaseUrl(url = BASE_URL) {
  return String(url).replace(/\/$/, "");
}
async function searchDanbooruTags({ query, login = "", apiKey = "", baseUrl = BASE_URL, limit = 20, signal } = {}) {
  const keyword = String(query || "").trim();
  if (!keyword) return [];
  const url = new URL(`${cleanBaseUrl(baseUrl)}/tags.json`);
  url.searchParams.set("search[name_matches]", `${keyword}*`);
  url.searchParams.set("limit", String(Math.max(1, Math.min(50, Number(limit) || 20))));
  if (login && apiKey) {
    url.searchParams.set("login", login);
    url.searchParams.set("api_key", apiKey);
  }
  const response = await fetch(url, { method: "GET", credentials: "omit", signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Danbooru HTTP ${response.status}`);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map((tag) => ({
    name: tag.name,
    category: Number(tag.category ?? 0),
    postCount: Number(tag.post_count ?? 0)
  }));
}
var DANBOORU_CATEGORY = Object.freeze({ 0: "\u4E00\u822C", 1: "\u753B\u5E08", 3: "\u7248\u6743", 4: "\u89D2\u8272", 5: "\u5143\u6807\u7B7E" });

// core/message-target.js
function esc(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
function findMessageElement(messageId) {
  const id = String(messageId ?? "");
  if (!id) return null;
  const safe = esc(id);
  const selectors = [`[mesid="${safe}"]`, `[data-message-id="${safe}"]`, `[data-mesid="${safe}"]`, `.mes[mesid="${safe}"]`, `#chat .mes:nth-child(${Number.isInteger(Number(id)) ? Number(id) + 1 : 0})`];
  return selectors.filter((s) => !s.includes("nth-child(0)")).map((s) => {
    try {
      return document.querySelector(s);
    } catch {
      return null;
    }
  }).find(Boolean) || null;
}
function messageTextRoot(messageId) {
  const root = findMessageElement(messageId);
  return root?.querySelector(".mes_text, .message_text, .mes_content") || root || null;
}
function collectLogicalText(root) {
  const infos = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode(node2) {
    if (node2.nodeType === Node.ELEMENT_NODE) return node2.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    const parent = node2.parentElement;
    if (!node2.nodeValue || parent?.closest(".sf-inline-action, button, script, style")) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  } });
  let text = "", node;
  while (node = walker.nextNode()) {
    const start = text.length, value = node.nodeType === Node.TEXT_NODE ? node.nodeValue : "\n";
    text += value;
    infos.push({ node, start, end: text.length, value });
  }
  return { text, infos };
}
function boundaryAt(infos, position, isEnd = false) {
  for (const info of infos) if (position >= info.start && position <= info.end) {
    if (info.node.nodeType === Node.TEXT_NODE) return { node: info.node, offset: Math.max(0, Math.min(info.node.nodeValue.length, position - info.start)) };
    const parent = info.node.parentNode, index = [...parent.childNodes].indexOf(info.node);
    return { node: parent, offset: index + (isEnd ? 1 : 0) };
  }
  return null;
}
function findMatchRange(root, matched) {
  const { text, infos } = collectLogicalText(root);
  const wanted = String(matched || "");
  let start = text.indexOf(wanted);
  if (start < 0) {
    const marker = wanted.match(/^(.*?)(?:[\r\n]|$)/)?.[1]?.trim() || "";
    if (marker) start = text.indexOf(marker);
    if (start >= 0) {
      const endMarker = wanted.slice(wanted.lastIndexOf("###"));
      const end = endMarker ? text.indexOf(endMarker, start + marker.length) : -1;
      if (end >= 0) return { start, end: end + endMarker.length, infos };
    }
    return null;
  }
  return { start, end: start + wanted.length, infos };
}
function openTagPreview(item) {
  document.querySelector("#sf-tag-preview-modal")?.remove();
  const modal = document.createElement("div");
  modal.id = "sf-tag-preview-modal";
  modal.className = "sf-tag-modal";
  const raw = item.matched || item.prompt || "";
  modal.innerHTML = `<div class="sf-tag-modal-card" role="dialog" aria-modal="true"><div class="sf-tag-modal-head"><b>\u539F\u59CB\u56FE\u7247 Tag</b><button aria-label="\u5173\u95ED">\xD7</button></div><pre></pre><div class="sf-tag-modal-actions"><button data-copy>\u590D\u5236 Tag</button><button data-close>\u5173\u95ED</button></div></div>`;
  modal.querySelector("pre").textContent = raw;
  const close = () => modal.remove();
  modal.querySelector('[aria-label="\u5173\u95ED"]').onclick = close;
  modal.querySelector("[data-close]").onclick = close;
  modal.querySelector("[data-copy]").onclick = async () => {
    try {
      await navigator.clipboard.writeText(raw);
    } catch {
    }
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.body.append(modal);
}
function updateButton(button, item) {
  const status = item.status || "pending";
  const loading = status === "generating" || status === "queued";
  const failed = status === "failed";
  const label = status === "generating" ? "\u751F\u6210\u4E2D\u2026" : status === "queued" ? "\u6392\u961F\u4E2D\u2026" : failed ? "\u91CD\u65B0\u751F\u6210\u56FE\u7247" : status === "completed" ? "\u56FE\u7247\u5DF2\u751F\u6210" : "\u751F\u6210\u56FE\u7247";
  button.disabled = loading || status === "completed";
  button.classList.toggle("sf-loading", loading);
  button.classList.toggle("sf-generate-failed", failed);
  button.innerHTML = `${loading ? '<span class="sf-spinner"></span>' : "\u{1F5BC}\uFE0F"} ${label}`;
  button.title = failed ? `\u751F\u6210\u5931\u8D25\uFF1A${item.error || "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u957F\u6309\u67E5\u770B\u539F\u59CB Tag` : "\u957F\u6309\u67E5\u770B\u539F\u59CB Tag";
}
function bindButton(button, item, onGenerate) {
  let timer = null, longPressed = false;
  button.addEventListener("pointerdown", () => {
    longPressed = false;
    timer = setTimeout(() => {
      longPressed = true;
      openTagPreview(item);
    }, 550);
  });
  for (const event of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(event, () => clearTimeout(timer));
  button.addEventListener("click", (event) => {
    if (longPressed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    onGenerate?.(item);
  });
}
function renderGenerateAction({ messageId, item, onGenerate }) {
  const root = messageTextRoot(messageId);
  if (!root) return false;
  const id = String(item.id);
  let button = root.querySelector(`button.sf-inline-action[data-sf-id="${esc(id)}"]`);
  if (!button) {
    const hit = findMatchRange(root, item.matched);
    if (!hit) return false;
    const start = boundaryAt(hit.infos, hit.start), end = boundaryAt(hit.infos, hit.end, true);
    if (!start || !end) return false;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      button = document.createElement("button");
      button.type = "button";
      button.className = "image-tag-button st-chatu8-image-button sf-inline-action";
      button.dataset.sfId = id;
      range.deleteContents();
      range.insertNode(button);
    } catch {
      return false;
    }
    bindButton(button, item, onGenerate);
  }
  updateButton(button, item);
  return true;
}
function insertImageBelowMessage({ messageId, blob, prompt }) {
  const target = findMessageElement(messageId), url = URL.createObjectURL(blob);
  if (!target) return { inserted: false, url };
  const figure = document.createElement("figure");
  figure.className = "sf-image-item";
  const img = document.createElement("img");
  img.src = url;
  img.alt = prompt || "SceneFrame";
  img.loading = "lazy";
  img.title = prompt || "";
  figure.append(img);
  const action = target.querySelector(".sf-inline-action");
  if (action) action.insertAdjacentElement("afterend", figure);
  else target.append(figure);
  return { inserted: true, url };
}

// core/cache.js
var DB = "scene_frame_cache";
var STORE = "images";
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function putImage(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// core/event-bridge.js
var EVENT_NAMES = ["MESSAGE_RECEIVED", "MESSAGE_UPDATED", "MESSAGE_EDITED", "MESSAGE_SWIPED", "GENERATION_ENDED", "STREAM_TOKEN_RECEIVED"];
function getTavernContext() {
  try {
    return window.SillyTavern?.getContext?.() || window.getContext?.() || null;
  } catch {
    return null;
  }
}
function resolveEvent(name) {
  const tables = [window.event_types, window.tavern_events, window.TAVERN_EVENTS, window.eventSource?.EVENTS];
  for (const table of tables) if (table?.[name]) return table[name];
  return name;
}
function resolveMessage(value) {
  const context = getTavernContext();
  const chat = context?.chat || window.chat || [];
  if (typeof value === "number" && chat[value]) return { ...chat[value], message_id: value };
  if (typeof value === "string" && /^\d+$/.test(value) && chat[Number(value)]) return { ...chat[Number(value)], message_id: Number(value) };
  if (Array.isArray(value)) return resolveMessage(value.at(-1));
  if (value && typeof value === "object") {
    if (typeof value.message_id === "number" && chat[value.message_id]) return { ...chat[value.message_id], ...value };
    return value;
  }
  return chat.at(-1) || {};
}
function subscribeToMessages(handler) {
  const unsubs = [], seen = /* @__PURE__ */ new Set();
  const callback = (...args) => {
    const message = resolveMessage(args.find((x) => x !== void 0));
    const key = `${message.message_id ?? message.id ?? "unknown"}:${String(message.mes || message.message || "").length}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 300) seen.delete(seen.values().next().value);
    handler(message);
  };
  const eventSource = window.eventSource;
  if (eventSource?.on) {
    for (const name of EVENT_NAMES) {
      try {
        const event = resolveEvent(name);
        eventSource.on(event, callback);
        unsubs.push(() => eventSource.off?.(event, callback));
      } catch (error) {
        console.debug("[SceneFrame] eventSource skipped", name, error);
      }
    }
  }
  const context = getTavernContext();
  const eventOn = window.eventOn || context?.eventOn;
  if (typeof eventOn === "function") {
    for (const name of EVENT_NAMES) {
      try {
        const event = resolveEvent(name), result = eventOn(event, callback);
        if (typeof result === "function") unsubs.push(result);
      } catch (error) {
        console.debug("[SceneFrame] eventOn skipped", name, error);
      }
    }
  }
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(), 180);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  unsubs.push(() => {
    clearTimeout(timer);
    observer.disconnect();
  });
  return () => unsubs.forEach((fn) => {
    try {
      fn();
    } catch {
    }
  });
}

// core/message-store.js
var KEY = "scene_frame_message_state";
function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}
function write(value) {
  localStorage.setItem(KEY, JSON.stringify(value));
}
function getRecord(messageId) {
  return read()[String(messageId)] || null;
}
function rememberBlock(messageId, hash, item) {
  const all = read(), key = String(messageId ?? "unknown");
  all[key] || (all[key] = {});
  all[key][hash] = { ...item, savedAt: Date.now() };
  write(all);
}
function hasBlock(messageId, hash) {
  return Boolean(read()[String(messageId ?? "unknown")]?.[hash]);
}

// source.js
var SETTINGS_KEY = "scene-frame-st";
var LEGACY_SETTINGS_KEY = "scene_frame_settings";
var defaults = { enabled: true, autoGenerate: false, backend: "sd", naiKey: "", naiUrl: "https://image.novelai.net", naiModel: "nai-diffusion-4-5-full", naiSampler: "k_euler", naiScale: 5, naiSeed: -1, naiSamples: 1, naiUcPreset: 2, naiQualityToggle: true, naiSmea: false, naiSmeaDyn: false, naiWidth: 832, naiHeight: 1216, naiSteps: 28, sdUrl: "http://127.0.0.1:7860", danbooruLogin: "", danbooruKey: "", danbooruUrl: "https://danbooru.donmai.us", positivePrefix: "", negative: "", presets: [], activePresetId: "", parserRules: DEFAULT_IMAGE_RULES.map((rule) => ({ ...rule })), activeParserRuleId: "marker-image-hash", width: 768, height: 1024, steps: 28 };
function settingsRoot() {
  return globalThis.extension_settings || globalThis.SillyTavern?.getContext?.()?.extensionSettings || null;
}
function readSavedSettings() {
  let legacy = {};
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) || "{}") || {};
  } catch {
  }
  const root = settingsRoot(), current = root?.[SETTINGS_KEY] || {};
  const merged = { ...defaults, ...legacy, ...current };
  if (root) {
    root[SETTINGS_KEY] = merged;
    try {
      (globalThis.saveSettingsDebounced || globalThis.saveSettings)?.();
    } catch {
    }
  }
  return merged;
}
var state = { settings: readSavedSettings(), seen: /* @__PURE__ */ new Set(), current: null, pending: [], tasks: [], fabDragged: false, page: "generate", panelOpen: false, panelScrollTop: 0, parserPreview: "", scanTimer: null, lastChatKey: "" };
function save() {
  const root = settingsRoot();
  if (root) {
    root[SETTINGS_KEY] = state.settings;
    try {
      (globalThis.saveSettingsDebounced || globalThis.saveSettings)?.();
    } catch {
    }
  }
  try {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
  }
}
function val(sel) {
  return document.querySelector(sel)?.value ?? "";
}
function setStatus(text) {
  const el = document.querySelector("#sf-status");
  if (el) el.textContent = text;
}
function getNativeEvents() {
  return globalThis.eventSource || globalThis.SillyTavern?.getContext?.()?.eventSource || null;
}
function getNativeEventTypes() {
  return globalThis.event_types || globalThis.eventTypes || {};
}
function getChatMessages() {
  return getTavernContext()?.chat || globalThis.chat || [];
}
function showError(message) {
  const old = document.querySelector("#sf-error-toast");
  old?.remove();
  const toast = document.createElement("div");
  toast.id = "sf-error-toast";
  toast.className = "sf-error-toast";
  toast.innerHTML = `<b>\u56FE\u7247\u751F\u6210\u5931\u8D25</b><span>${escapeHtml(message)}</span><button aria-label="\u5173\u95ED">\xD7</button>`;
  document.body.append(toast);
  toast.querySelector("button").onclick = () => toast.remove();
  setTimeout(() => toast.remove(), 8e3);
}
function readControl(id, fallback = "") {
  return document.querySelector(`#${id}`)?.value ?? fallback;
}
function saveAllSettings() {
  const s = state.settings;
  s.backend = readControl("sf-backend", s.backend);
  s.naiUrl = readControl("sf-url", s.naiUrl);
  s.naiKey = readControl("sf-key", s.naiKey);
  s.positivePrefix = readControl("sf-prefix", s.positivePrefix);
  s.negative = readControl("sf-negative", s.negative);
  s.naiModel = readControl("sf-nai-model", s.naiModel);
  s.naiSampler = readControl("sf-nai-sampler", s.naiSampler);
  for (const [key, id] of Object.entries({ naiScale: "sf-nai-scale", naiSeed: "sf-nai-seed", naiSamples: "sf-nai-samples", naiUcPreset: "sf-nai-ucpreset", naiWidth: "sf-nai-width", naiHeight: "sf-nai-height", naiSteps: "sf-nai-steps" })) s[key] = Number(readControl(id, s[key]));
  const quality = document.querySelector("#sf-nai-quality"), smea = document.querySelector("#sf-nai-smea"), smeaDyn = document.querySelector("#sf-nai-smeadyn");
  if (quality) s.naiQualityToggle = quality.checked;
  if (smea) s.naiSmea = smea.checked;
  if (smeaDyn) s.naiSmeaDyn = smeaDyn.checked;
  s.danbooruLogin = readControl("sf-danbooru-login", s.danbooruLogin).trim();
  s.danbooruKey = readControl("sf-danbooru-key", s.danbooruKey).trim();
  save();
  setStatus("\u2705 \u5DF2\u4FDD\u5B58\u5168\u90E8\u8BBE\u7F6E\u5230\u672C\u673A");
}
function composePrompt(scenePrompt = "") {
  return normalizePrompt([state.settings.positivePrefix, scenePrompt].filter(Boolean).join(", "));
}
function presetById(id) {
  return (state.settings.presets || []).find((x) => x.id === id) || null;
}
function parserRuleById(id) {
  return (state.settings.parserRules || []).find((x) => x.id === id) || null;
}
function updateParserRule(id, patch) {
  state.settings.parserRules = state.settings.parserRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule);
  save();
}
function renderParserRules() {
  const box = document.querySelector("#sf-parser-list");
  if (!box) return;
  const rules = state.settings.parserRules || [];
  box.innerHTML = rules.length ? rules.map((rule) => `<article class="sf-rule-card" data-rule-id="${escapeHtml(rule.id)}"><div><b>${escapeHtml(rule.name)}</b><small>${rule.mode === "regex" ? "\u9AD8\u7EA7\u6B63\u5219" : `${escapeHtml(rule.start || "")} \u2192 ${escapeHtml(rule.end || "")}`}</small></div><div class="sf-row"><button data-rule-act="select">\u7F16\u8F91</button><button data-rule-act="toggle">${rule.enabled === false ? "\u542F\u7528" : "\u505C\u7528"}</button><button data-rule-act="delete">\u5220\u9664</button></div></article>`).join("") : '<div class="sf-empty">\u6682\u65E0\u89E3\u6790\u89C4\u5219</div>';
  box.querySelectorAll("[data-rule-act]").forEach((button) => button.onclick = () => {
    const id = button.closest("[data-rule-id]").dataset.ruleId, rule = parserRuleById(id);
    if (!rule) return;
    const act = button.dataset.ruleAct;
    if (act === "select") {
      state.settings.activeParserRuleId = id;
      render();
    }
    if (act === "toggle") {
      updateParserRule(id, { enabled: rule.enabled === false });
      renderParserRules();
    }
    if (act === "delete") {
      state.settings.parserRules = state.settings.parserRules.filter((x) => x.id !== id);
      if (state.settings.activeParserRuleId === id) state.settings.activeParserRuleId = state.settings.parserRules[0]?.id || "";
      save();
      render();
    }
  });
}
function fillParserEditor() {
  const rule = parserRuleById(state.settings.activeParserRuleId) || (state.settings.parserRules || [])[0];
  if (!rule) return;
  state.settings.activeParserRuleId = rule.id;
  const set = (id, value) => {
    const el = document.querySelector(`#${id}`);
    if (el) el.value = value ?? "";
  };
  set("sf-rule-name", rule.name);
  set("sf-rule-mode", rule.mode);
  set("sf-rule-start", rule.start);
  set("sf-rule-end", rule.end);
  set("sf-rule-pattern", rule.pattern);
  set("sf-rule-flags", rule.flags || "gi");
  const enabled = document.querySelector("#sf-rule-enabled");
  if (enabled) enabled.checked = rule.enabled !== false;
  const markers = document.querySelector("#sf-rule-markers"), regex = document.querySelector("#sf-rule-regex");
  if (markers) markers.classList.toggle("sf-hidden", rule.mode === "regex");
  if (regex) regex.classList.toggle("sf-hidden", rule.mode !== "regex");
}
function applyPreset(id) {
  const preset = presetById(id);
  if (!preset) return;
  state.settings.positivePrefix = preset.positivePrefix || "";
  state.settings.negative = preset.negative || "";
  state.settings.activePresetId = preset.id;
  save();
}
async function generate(item) {
  const s = state.settings, fullPrompt = composePrompt(item.prompt);
  setStatus(`\u23F3 \u6B63\u5728\u4F7F\u7528 ${s.backend === "nai" ? "NovelAI" : "A1111/Forge"} \u751F\u6210\u2026`);
  const result = s.backend === "nai" ? await generateNAI({ apiKey: s.naiKey, baseUrl: s.naiUrl, model: s.naiModel, sampler: s.naiSampler, scale: Number(s.naiScale), seed: Number(s.naiSeed), nSamples: Number(s.naiSamples), ucPreset: Number(s.naiUcPreset), qualityToggle: Boolean(s.naiQualityToggle), smea: Boolean(s.naiSmea), smeaDyn: Boolean(s.naiSmeaDyn), prompt: fullPrompt, negativePrompt: s.negative, width: Number(s.naiWidth), height: Number(s.naiHeight), steps: Number(s.naiSteps) }) : await generateSD({ baseUrl: s.sdUrl, prompt: fullPrompt, negativePrompt: s.negative, width: Number(s.width), height: Number(s.height), steps: Number(s.steps) });
  await putImage({ id: item.id, messageId: item.messageId ?? null, prompt: fullPrompt, blob: result.blob, createdAt: Date.now(), backend: result.backend });
  const inserted = item.messageId == null ? false : insertImageBelowMessage({ messageId: item.messageId, blob: result.blob, prompt: fullPrompt }).inserted;
  state.pending = state.pending.filter((x) => x.id !== item.id);
  setStatus(`\u2705 \u751F\u6210\u5B8C\u6210${inserted ? "\uFF0C\u5DF2\u5C1D\u8BD5\u63D2\u5165\u6D88\u606F" : ""}`);
  renderPending();
  return result;
}
var queue = new TaskQueue({ onChange: (tasks) => {
  state.tasks = tasks;
  for (const item of tasks) if (item.messageId != null) scheduleInlineAction(item);
  const failed = tasks.find((x) => x.status === "failed" && !x.errorShown);
  if (failed) {
    failed.errorShown = true;
    showError(failed.error || "\u672A\u77E5\u9519\u8BEF");
  }
  renderPending();
  console.debug("[SceneFrame]", tasks);
} });
function dismissItem(item) {
  state.pending = state.pending.filter((x) => x.id !== item.id);
  renderPending();
}
function enqueueItem(item) {
  const queued = queue.add({ ...item, run: generate });
  if (!queued) setStatus("\u8BE5\u56FE\u7247\u4EFB\u52A1\u6B63\u5728\u5904\u7406\u4E2D");
}
function addPending(item) {
  state.pending = [...state.pending.filter((x) => x.id !== item.id), item];
  state.current = item;
  renderPending();
  scheduleInlineAction(item);
}
function renderPending() {
  const box = document.querySelector("#sf-detected");
  if (!box) return;
  box.innerHTML = state.pending.length ? state.pending.map((item) => `<article class="sf-detected-card" data-id="${item.id}"><div class="sf-detected-head"><b>\u{1F5BC}\uFE0F \u56FE\u7247\u5757</b><span>${item.messageId == null ? "\u672A\u7ED1\u5B9A\u697C\u5C42" : `\u697C\u5C42 ${item.messageId}`}</span></div><div class="sf-preview">${escapeHtml(item.prompt)}</div><div class="sf-row"><button data-pending="generate">\u751F\u6210</button><button data-pending="edit">\u7F16\u8F91</button><button data-pending="dismiss">\u5FFD\u7565</button></div></article>`).join("") : '<div class="sf-empty">\u5C1A\u672A\u68C0\u6D4B\u5230\u65B0\u7684\u56FE\u7247\u5757</div>';
  box.querySelectorAll("[data-pending]").forEach((btn) => btn.onclick = async () => {
    const item = state.pending.find((x) => x.id === btn.closest("[data-id]").dataset.id);
    if (!item) return;
    if (btn.dataset.pending === "generate") enqueueItem(item);
    if (btn.dataset.pending === "edit") {
      document.querySelector("#sf-prompt").value = item.prompt;
      state.current = item;
      setStatus("\u5DF2\u8F7D\u5165\u7F16\u8F91\u6846");
    }
    if (btn.dataset.pending === "dismiss") {
      state.pending = state.pending.filter((x) => x.id !== item.id);
      renderPending();
      setStatus("\u5DF2\u5FFD\u7565\u8BE5\u56FE\u7247\u5757");
    }
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function appendTagsToPrompt(tags) {
  const field = document.querySelector("#sf-prompt");
  if (!field) return;
  field.value = normalizePrompt([field.value, ...tags].filter(Boolean).join(", "));
}
function renderDanbooruResults(rows = []) {
  const box = document.querySelector("#sf-danbooru-results");
  if (!box) return;
  box.innerHTML = rows.length ? rows.map((tag) => `<button class="sf-tag" data-tag="${escapeHtml(tag.name)}" title="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}<small>${DANBOORU_CATEGORY[tag.category] || "\u5176\u4ED6"} \xB7 ${tag.postCount.toLocaleString()}</small></button>`).join("") : '<div class="sf-empty">\u8F93\u5165\u82F1\u6587 tag \u641C\u7D22\uFF1B\u70B9\u51FB\u7ED3\u679C\u52A0\u5165\u52A8\u6001\u56FE\u7247\u63D0\u793A\u8BCD</div>';
  box.querySelectorAll("[data-tag]").forEach((button) => button.onclick = () => {
    appendTagsToPrompt([button.dataset.tag]);
    setStatus(`\u5DF2\u52A0\u5165 tag\uFF1A${button.dataset.tag}`);
  });
}
async function runDanbooruSearch() {
  const query = val("#sf-danbooru-query").trim();
  if (!query) return setStatus("\u8BF7\u8F93\u5165\u8981\u641C\u7D22\u7684 Danbooru tag");
  const button = document.querySelector("[data-act=search-danbooru]");
  if (button) button.disabled = true;
  try {
    setStatus("\u23F3 \u6B63\u5728\u67E5\u8BE2 Danbooru \u6807\u7B7E\u2026");
    const rows = await searchDanbooruTags({ query, login: state.settings.danbooruLogin, apiKey: state.settings.danbooruKey, baseUrl: state.settings.danbooruUrl });
    renderDanbooruResults(rows);
    setStatus(`\u2705 Danbooru \u8FD4\u56DE ${rows.length} \u4E2A\u6807\u7B7E`);
  } catch (error) {
    setStatus(`\u26A0\uFE0F Danbooru \u67E5\u8BE2\u5931\u8D25\uFF1A${error.message || error}`);
    renderDanbooruResults([]);
  } finally {
    if (button) button.disabled = false;
  }
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function placeFab(fab) {
  const pos = state.settings.fabPosition;
  if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
    fab.style.left = `${clamp(pos.left, 8, innerWidth - 58)}px`;
    fab.style.top = `${clamp(pos.top, 8, innerHeight - 58)}px`;
    fab.style.right = "auto";
    fab.style.bottom = "auto";
  }
}
function makeFabDraggable(fab) {
  let startX = 0, startY = 0, left = 0, top = 0, dragging = false, activeId = null;
  const move = (event) => {
    if (activeId == null || event.pointerId !== activeId) return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragging = true;
    if (!dragging) return;
    const x = clamp(left + dx, 8, innerWidth - fab.offsetWidth - 8), y = clamp(top + dy, 8, innerHeight - fab.offsetHeight - 8);
    fab.style.left = `${x}px`;
    fab.style.top = `${y}px`;
    fab.style.right = "auto";
    fab.style.bottom = "auto";
  };
  const finish = (event) => {
    if (activeId == null || event.pointerId !== activeId) return;
    activeId = null;
    fab.classList.remove("sf-grabbing");
    if (dragging) {
      const rect = fab.getBoundingClientRect();
      state.settings.fabPosition = { left: Math.round(rect.left), top: Math.round(rect.top) };
      state.fabDragged = true;
      save();
    }
  };
  fab.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    const rect = fab.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    left = rect.left;
    top = rect.top;
    dragging = false;
    activeId = event.pointerId;
    fab.classList.add("sf-grabbing");
  });
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", finish, { passive: true });
  window.addEventListener("pointercancel", finish, { passive: true });
}
function render() {
  const previousSheet = document.querySelector("#scene-frame-root .sf-sheet");
  if (previousSheet) state.panelScrollTop = previousSheet.scrollTop;
  document.querySelector("#scene-frame-root")?.remove();
  const root = document.createElement("div");
  root.id = "scene-frame-root";
  root.innerHTML = `<button class="sf-fab" title="SceneFrame">\u{1F5BC}\uFE0F</button><section class="sf-sheet ${state.panelOpen ? "" : "sf-hidden"}"><div class="sf-title"><b>\u955C\u5323 SceneFrame</b><button data-act="close" aria-label="\u5173\u95ED">\xD7</button></div><div class="sf-row"><select id="sf-backend" class="sf-input"><option value="sd">A1111 / Forge</option><option value="nai">NovelAI</option></select><button data-act="toggle">\u81EA\u52A8\uFF1A${state.settings.autoGenerate ? "\u5F00" : "\u5173"}</button></div><div class="sf-section-title">\u63D0\u793A\u8BCD\u65B9\u6848 \xB7 \u4EC5\u4FDD\u5B58\u524D\u7F6E / \u8D1F\u9762\u8BCD</div><div class="sf-row"><select id="sf-preset" class="sf-input"><option value="">\u672A\u9009\u62E9\u65B9\u6848</option></select><button data-act="save-preset">\u53E6\u5B58\u65B9\u6848</button><button data-act="delete-preset">\u5220\u9664</button></div><input id="sf-preset-name" class="sf-input" placeholder="\u65B9\u6848\u540D\u79F0\uFF0C\u4F8B\u5982 NAI\xB7\u6C34\u5F69\u753B\u5E08\u4E32"><div class="sf-section-title">\u524D\u7F6E\u63D0\u793A\u8BCD \xB7 \u753B\u5E08\u4E32 / \u56FA\u5B9A\u753B\u98CE</div><textarea id="sf-prefix" class="sf-textarea sf-short" placeholder="\u4F8B\u5982\uFF1Aartist:xxx, artist:yyy, watercolor, anime coloring"></textarea><div class="sf-section-title">\u8D1F\u9762\u63D0\u793A\u8BCD \xB7 \u8DDF\u968F\u65B9\u6848\u4FDD\u5B58</div><textarea id="sf-negative" class="sf-textarea sf-short" placeholder="\u4F8B\u5982\uFF1Alowres, bad anatomy, bad hands, text"></textarea><nav class="sf-tabs"><button data-page="generate" class="${state.page === "generate" ? "sf-tab-active" : ""}">\u751F\u56FE</button><button data-page="danbooru" class="${state.page === "danbooru" ? "sf-tab-active" : ""}">\u6807\u7B7E\u5E93</button><button data-page="parser" class="${state.page === "parser" ? "sf-tab-active" : ""}">\u89E3\u6790\u89C4\u5219</button></nav><section class="sf-page ${state.page === "generate" ? "" : "sf-hidden"}" data-page-content="generate"><div class="sf-section-title">\u68C0\u6D4B\u5230\u7684\u56FE\u7247\u5757</div><div id="sf-detected"></div><div class="sf-section-title">\u52A8\u6001\u56FE\u7247\u63D0\u793A\u8BCD \xB7 \u6765\u81EA &lt;image&gt; \u6807\u7B7E</div><input id="sf-url" class="sf-input" placeholder="\u540E\u7AEF\u5730\u5740"><input id="sf-key" class="sf-input" type="password" placeholder="NovelAI API Key\uFF08\u4EC5\u672C\u5730\uFF09"><details class="sf-params" id="sf-nai-params"><summary>NovelAI \u53C2\u6570\u8BBE\u7F6E</summary><div class="sf-param-grid"><label>\u6A21\u578B<select id="sf-nai-model" class="sf-input"><option value="nai-diffusion-4-5-full">NAI Diffusion 4.5 Full</option><option value="nai-diffusion-4-5-curated-preview">NAI Diffusion 4.5 Curated</option><option value="nai-diffusion-4-curated-preview">NAI Diffusion 4 Curated</option></select></label><label>\u91C7\u6837\u5668<select id="sf-nai-sampler" class="sf-input"><option value="k_euler">Euler</option><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option><option value="k_dpmpp_sde">DPM++ SDE</option><option value="k_lms">LMS</option></select></label><label>\u5BBD\u5EA6<input id="sf-nai-width" class="sf-input" type="number" min="64" step="64"></label><label>\u9AD8\u5EA6<input id="sf-nai-height" class="sf-input" type="number" min="64" step="64"></label><label>\u6B65\u6570<input id="sf-nai-steps" class="sf-input" type="number" min="1" max="50"></label><label>CFG / Scale<input id="sf-nai-scale" class="sf-input" type="number" min="0" max="20" step="0.1"></label><label>Seed\uFF08-1 \u968F\u673A\uFF09<input id="sf-nai-seed" class="sf-input" type="number" step="1"></label><label>\u51FA\u56FE\u6570<input id="sf-nai-samples" class="sf-input" type="number" min="1" max="4"></label><label>UC \u9884\u8BBE<select id="sf-nai-ucpreset" class="sf-input"><option value="0">0 \xB7 \u65E0</option><option value="1">1 \xB7 Light</option><option value="2">2 \xB7 Heavy</option><option value="3">3 \xB7 Human Focus</option></select></label><label class="sf-check"><input id="sf-nai-quality" type="checkbox"> \u542F\u7528 Quality Toggle</label><label class="sf-check"><input id="sf-nai-smea" type="checkbox"> \u542F\u7528 SMEA</label><label class="sf-check"><input id="sf-nai-smeadyn" type="checkbox"> \u542F\u7528 SMEA Dynamic</label></div></details><textarea id="sf-prompt" class="sf-textarea" placeholder="AI \u56FE\u7247\u5757\u6216\u624B\u52A8\u8F93\u5165\u7684\u573A\u666F prompt"></textarea><div class="sf-row"><button data-act="generate">\u751F\u6210</button><button data-act="clear">\u6E05\u7A7A\u573A\u666F</button></div></section><section class="sf-page ${state.page === "danbooru" ? "" : "sf-hidden"}" data-page-content="danbooru"><div class="sf-section-title">Danbooru \u6807\u7B7E\u5E93 \xB7 \u8D26\u6237\u914D\u7F6E</div><p class="sf-help">\u8F93\u5165\u8D26\u6237\u548C API Key \u540E\uFF0C\u53EF\u641C\u7D22\u5B98\u65B9\u6807\u7B7E\uFF1B\u70B9\u51FB\u6807\u7B7E\u4F1A\u52A0\u5165\u751F\u56FE\u9875\u7684\u52A8\u6001\u63D0\u793A\u8BCD\u3002</p><input id="sf-danbooru-login" class="sf-input" placeholder="Danbooru \u8D26\u6237\u540D"><input id="sf-danbooru-key" class="sf-input" type="password" placeholder="Danbooru API Key\uFF08\u4EC5\u672C\u5730\u4FDD\u5B58\uFF09"><div class="sf-section-title">\u641C\u7D22\u6807\u7B7E</div><div class="sf-row"><input id="sf-danbooru-query" class="sf-input" placeholder="\u82F1\u6587 tag\uFF0C\u4F8B\u5982 blue_hair"><button data-act="search-danbooru">\u641C\u7D22</button></div><div id="sf-danbooru-results" class="sf-tag-results"></div></section><section class="sf-page ${state.page === "parser" ? "" : "sf-hidden"}" data-page-content="parser"><div class="sf-section-title">\u5185\u5BB9\u89E3\u6790 \xB7 \u56FE\u7247\u5757\u89C4\u5219</div><p class="sf-help">\u8BBE\u7F6E AI \u56DE\u590D\u4E2D\u7684\u5F00\u59CB\u4E0E\u7ED3\u675F\u6807\u8BB0\u3002\u53EA\u6709\u6807\u8BB0\u4E4B\u95F4\u7684\u5185\u5BB9\u4F1A\u4F5C\u4E3A\u52A8\u6001\u56FE\u7247\u63D0\u793A\u8BCD\uFF0C\u4E0D\u4F1A\u6539\u52A8\u6B63\u6587\u3002</p><div id="sf-parser-list"></div><details class="sf-params" open><summary>\u7F16\u8F91\u89C4\u5219</summary><input id="sf-rule-name" class="sf-input" placeholder="\u89C4\u5219\u540D\u79F0"><div class="sf-row"><select id="sf-rule-mode" class="sf-input"><option value="markers">\u5F00\u59CB / \u7ED3\u675F\u6807\u8BB0</option><option value="regex">\u9AD8\u7EA7\u6B63\u5219</option></select><label class="sf-check sf-inline-check"><input id="sf-rule-enabled" type="checkbox"> \u542F\u7528</label></div><div id="sf-rule-markers"><label class="sf-field-label">\u5F00\u59CB\u6807\u8BB0<input id="sf-rule-start" class="sf-input" placeholder="\u4F8B\u5982 image###"></label><label class="sf-field-label">\u7ED3\u675F\u6807\u8BB0<input id="sf-rule-end" class="sf-input" placeholder="\u4F8B\u5982 ###"></label></div><div id="sf-rule-regex" class="sf-hidden"><label class="sf-field-label">\u6B63\u5219\uFF08\u7B2C 1 \u4E2A\u6355\u83B7\u7EC4\u4E3A\u56FE\u7247\u63D0\u793A\u8BCD\uFF09<textarea id="sf-rule-pattern" class="sf-textarea sf-short" placeholder="\u4F8B\u5982 [image]([sS]*?)[/image]"></textarea></label><label class="sf-field-label">Flags<input id="sf-rule-flags" class="sf-input" placeholder="gi"></label></div><div class="sf-row"><button data-act="save-rule">\u4FDD\u5B58\u89C4\u5219</button><button data-act="new-rule">\u65B0\u5EFA\u89C4\u5219</button></div></details><div class="sf-section-title">\u89E3\u6790\u9884\u89C8</div><textarea id="sf-parser-preview" class="sf-textarea sf-short" placeholder="\u7C98\u8D34\u4E00\u6BB5 AI \u56DE\u590D\uFF0C\u67E5\u770B\u8BE5\u89C4\u5219\u80FD\u5426\u63D0\u53D6\u56FE\u7247\u5757"></textarea><div class="sf-row"><button data-act="test-rule">\u6D4B\u8BD5\u89E3\u6790</button><button data-act="scan-chat">\u626B\u63CF\u5F53\u524D\u804A\u5929</button></div><div id="sf-parser-result" class="sf-preview sf-parser-result">\u5C1A\u672A\u6D4B\u8BD5</div></section><div id="sf-status" class="sf-status">v0.3.0 \xB7 \u89D2\u8272\u5361\u8FDB\u5165 / \u65B0\u56DE\u590D\u81EA\u52A8\u66FF\u6362</div><button class="sf-save-all" data-act="save-all">\u4FDD\u5B58\u5168\u90E8\u8BBE\u7F6E</button></section>`;
  document.body.append(root);
  const sheet = root.querySelector(".sf-sheet");
  const fab = root.querySelector(".sf-fab");
  placeFab(fab);
  makeFabDraggable(fab);
  requestAnimationFrame(() => {
    sheet.scrollTop = Math.min(state.panelScrollTop, sheet.scrollHeight);
  });
  root.querySelector("#sf-backend").value = state.settings.backend;
  const urlInput = root.querySelector("#sf-url");
  if (urlInput) urlInput.value = state.settings.backend === "nai" ? state.settings.naiUrl : state.settings.sdUrl;
  root.querySelector("#sf-prefix").value = state.settings.positivePrefix;
  const negativeInput = root.querySelector("#sf-negative");
  if (negativeInput) negativeInput.value = state.settings.negative;
  const naiFields = { "sf-nai-model": "naiModel", "sf-nai-sampler": "naiSampler", "sf-nai-width": "naiWidth", "sf-nai-height": "naiHeight", "sf-nai-steps": "naiSteps", "sf-nai-scale": "naiScale", "sf-nai-seed": "naiSeed", "sf-nai-samples": "naiSamples", "sf-nai-ucpreset": "naiUcPreset" };
  for (const [id, key] of Object.entries(naiFields)) {
    const input = root.querySelector(`#${id}`);
    if (input) input.value = state.settings[key];
  }
  const qualityInput = root.querySelector("#sf-nai-quality");
  if (qualityInput) qualityInput.checked = state.settings.naiQualityToggle;
  const smeaInput = root.querySelector("#sf-nai-smea");
  if (smeaInput) smeaInput.checked = state.settings.naiSmea;
  const smeaDynInput = root.querySelector("#sf-nai-smeadyn");
  if (smeaDynInput) smeaDynInput.checked = state.settings.naiSmeaDyn;
  const danbooruLogin = root.querySelector("#sf-danbooru-login");
  if (danbooruLogin) {
    danbooruLogin.value = state.settings.danbooruLogin;
    renderDanbooruResults();
  }
  renderParserRules();
  fillParserEditor();
  const preview = root.querySelector("#sf-parser-preview");
  if (preview) preview.value = state.parserPreview;
  const presetSelect = root.querySelector("#sf-preset");
  presetSelect.insertAdjacentHTML("beforeend", (state.settings.presets || []).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join(""));
  presetSelect.value = state.settings.activePresetId || "";
  fab.onclick = () => {
    if (state.fabDragged) {
      state.fabDragged = false;
      return;
    }
    state.panelOpen = !state.panelOpen;
    sheet.classList.toggle("sf-hidden", !state.panelOpen);
    renderPending();
  };
  root.querySelector("[data-act=close]").onclick = () => {
    state.panelOpen = false;
    sheet.classList.add("sf-hidden");
  };
  renderPending();
  root.querySelector("[data-act=toggle]").onclick = () => {
    state.settings.autoGenerate = !state.settings.autoGenerate;
    save();
    render();
  };
  root.querySelector("#sf-backend").onchange = (e) => {
    saveAllSettings();
    state.settings.backend = e.target.value;
    save();
    render();
  };
  root.querySelector("#sf-url")?.addEventListener("change", (e) => {
    if (state.settings.backend === "nai") state.settings.naiUrl = e.target.value;
    else state.settings.sdUrl = e.target.value;
    save();
  });
  root.querySelector("#sf-key")?.addEventListener("change", (e) => {
    state.settings.naiKey = e.target.value;
    save();
  });
  root.querySelector("#sf-prefix")?.addEventListener("change", (e) => {
    state.settings.positivePrefix = e.target.value;
    state.settings.activePresetId = "";
    save();
  });
  root.querySelector("#sf-negative")?.addEventListener("change", (e) => {
    state.settings.negative = e.target.value;
    state.settings.activePresetId = "";
    save();
  });
  root.querySelectorAll("[data-page]").forEach((button) => button.onclick = () => {
    state.page = button.dataset.page;
    render();
  });
  root.querySelector("#sf-rule-mode")?.addEventListener("change", (event) => {
    const markers = root.querySelector("#sf-rule-markers"), regex = root.querySelector("#sf-rule-regex");
    markers.classList.toggle("sf-hidden", event.target.value === "regex");
    regex.classList.toggle("sf-hidden", event.target.value !== "regex");
  });
  root.querySelector("[data-act=new-rule]")?.addEventListener("click", () => {
    const rule = { id: crypto.randomUUID(), name: "\u65B0\u56FE\u7247\u5757\u89C4\u5219", enabled: true, mode: "markers", start: "", end: "" };
    state.settings.parserRules.push(rule);
    state.settings.activeParserRuleId = rule.id;
    save();
    render();
  });
  root.querySelector("[data-act=save-rule]")?.addEventListener("click", () => {
    const id = state.settings.activeParserRuleId;
    const rule = parserRuleById(id);
    if (!rule) return;
    const mode = val("#sf-rule-mode");
    const patch = { name: val("#sf-rule-name").trim() || "\u672A\u547D\u540D\u89C4\u5219", enabled: root.querySelector("#sf-rule-enabled").checked, mode, start: val("#sf-rule-start"), end: val("#sf-rule-end"), pattern: val("#sf-rule-pattern"), flags: val("#sf-rule-flags") || "gi" };
    if (mode === "markers" && (!patch.start || !patch.end)) return setStatus("\u5F00\u59CB\u6807\u8BB0\u548C\u7ED3\u675F\u6807\u8BB0\u4E0D\u80FD\u4E3A\u7A7A");
    if (mode === "regex") {
      try {
        new RegExp(patch.pattern, patch.flags.replace(/[^gimsu]/g, ""));
      } catch (error) {
        return setStatus(`\u6B63\u5219\u65E0\u6548\uFF1A${error.message}`);
      }
    }
    updateParserRule(id, patch);
    renderParserRules();
    setStatus(`\u2705 \u5DF2\u4FDD\u5B58\u89E3\u6790\u89C4\u5219\uFF1A${patch.name}`);
  });
  root.querySelector("[data-act=test-rule]")?.addEventListener("click", () => {
    state.parserPreview = val("#sf-parser-preview");
    const rule = parserRuleById(state.settings.activeParserRuleId);
    const result = root.querySelector("#sf-parser-result");
    if (!rule) return;
    const rows = extractByRules(state.parserPreview, [{ ...rule, enabled: true }]);
    result.textContent = rows.length ? `\u6210\u529F\u63D0\u53D6 ${rows.length} \u4E2A\u56FE\u7247\u5757\uFF1A

${rows.map((x, i) => `${i + 1}. ${x.raw}`).join("\n\n")}` : "\u672A\u5339\u914D\u5230\u56FE\u7247\u5757\uFF1A\u8BF7\u68C0\u67E5\u5F00\u59CB/\u7ED3\u675F\u6807\u8BB0\u6216\u6B63\u5219\u7B2C 1 \u4E2A\u6355\u83B7\u7EC4\u3002";
  });
  root.querySelector("[data-act=scan-chat]")?.addEventListener("click", async () => {
    const count = await scanChatForImageBlocks();
    setStatus(count ? `\u2705 \u5DF2\u626B\u63CF\u5F53\u524D\u804A\u5929\uFF0C\u53D1\u73B0 ${count} \u4E2A\u65B0\u56FE\u7247\u5757` : "\u672A\u53D1\u73B0\u65B0\u56FE\u7247\u5757\uFF1B\u68C0\u67E5\u89C4\u5219\u662F\u5426\u542F\u7528\u3001\u5F00\u59CB/\u7ED3\u675F\u6807\u8BB0\u662F\u5426\u6B63\u786E");
  });
  root.querySelector("#sf-danbooru-login")?.addEventListener("change", (e) => {
    state.settings.danbooruLogin = e.target.value.trim();
    save();
  });
  root.querySelector("#sf-danbooru-key")?.addEventListener("change", (e) => {
    state.settings.danbooruKey = e.target.value.trim();
    save();
  });
  root.querySelector("[data-act=search-danbooru]")?.addEventListener("click", runDanbooruSearch);
  root.querySelector("#sf-danbooru-query")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runDanbooruSearch();
    }
  });
  presetSelect.onchange = (e) => {
    if (!e.target.value) return;
    applyPreset(e.target.value);
    render();
    setStatus("\u5DF2\u5207\u6362\u63D0\u793A\u8BCD\u65B9\u6848");
  };
  root.querySelector("[data-act=save-preset]").onclick = () => {
    const name = val("#sf-preset-name").trim();
    if (!name) return setStatus("\u8BF7\u5148\u586B\u5199\u65B9\u6848\u540D\u79F0");
    const existing = presetById(state.settings.activePresetId);
    const preset = { id: existing?.id || crypto.randomUUID(), name, positivePrefix: val("#sf-prefix"), negative: val("#sf-negative") };
    state.settings.presets = existing ? state.settings.presets.map((x) => x.id === preset.id ? preset : x) : [...state.settings.presets || [], preset];
    state.settings.activePresetId = preset.id;
    state.settings.positivePrefix = preset.positivePrefix;
    state.settings.negative = preset.negative;
    save();
    render();
    setStatus(`\u5DF2\u4FDD\u5B58\u65B9\u6848\uFF1A${name}`);
  };
  root.querySelector("[data-act=delete-preset]").onclick = () => {
    const id = state.settings.activePresetId;
    if (!id) return setStatus("\u8BF7\u5148\u9009\u62E9\u8981\u5220\u9664\u7684\u65B9\u6848");
    const name = presetById(id)?.name || "";
    state.settings.presets = state.settings.presets.filter((x) => x.id !== id);
    state.settings.activePresetId = "";
    save();
    render();
    setStatus(`\u5DF2\u5220\u9664\u65B9\u6848\uFF1A${name}`);
  };
  root.querySelector("[data-act=clear]").onclick = () => {
    root.querySelector("#sf-prompt").value = "";
    state.current = null;
  };
  root.querySelector("[data-act=save-all]").onclick = saveAllSettings;
  root.querySelector("[data-act=generate]").onclick = async () => {
    saveAllSettings();
    const prompt = normalizePrompt(val("#sf-prompt"));
    if (!prompt) return setStatus("\u8BF7\u8F93\u5165 prompt");
    const hash = await digest(prompt);
    const base = state.current || {};
    const item = { id: crypto.randomUUID(), hash, prompt, messageId: base.messageId ?? null };
    if (!queue.add({ ...item, run: generate })) setStatus("\u8BE5 prompt \u5DF2\u5728\u4EFB\u52A1\u961F\u5217\u4E2D");
  };
}
async function inspectMessage(message) {
  if (!state.settings.enabled) return [];
  const text = typeof message === "string" ? message : message?.mes || message?.message || "";
  const found = [];
  const messageId = message?.message_id ?? message?.id ?? message?.mesid ?? null;
  for (const block of extractByRules(text, state.settings.parserRules)) {
    const prompt = normalizePrompt(block.raw), hash = await digest(prompt), seenKey = `${messageId}:${hash}`;
    const stored = getRecord(messageId)?.[hash];
    const item = { ...stored || {}, id: stored?.id || crypto.randomUUID(), hash, prompt, messageId, matched: block.matched, ruleName: block.ruleName };
    if (state.seen.has(seenKey) || hasBlock(messageId, hash)) {
      scheduleInlineAction(item);
      continue;
    }
    state.seen.add(seenKey);
    rememberBlock(messageId, hash, item);
    found.push(item);
    if (state.settings.autoGenerate) enqueueItem(item);
    else {
      addPending(item);
      setStatus(`\u{1F5BC}\uFE0F \u68C0\u6D4B\u5230\u56FE\u7247\u5757\uFF08${block.ruleName || "\u89E3\u6790\u89C4\u5219"}\uFF09\uFF0C\u53EF\u5728\u804A\u5929\u5185\u70B9\u51FB\u751F\u6210\u56FE\u7247`);
    }
  }
  return found;
}
async function scanChatForImageBlocks() {
  const context = getTavernContext();
  const messages = getChatMessages() || context?.chat || [];
  let count = 0;
  for (let id = 0; id < messages.length; id++) {
    const message = { ...messages[id], message_id: id };
    count += (await inspectMessage(message)).length;
    const text = message.mes || message.message || "";
    for (const block of extractByRules(text, state.settings.parserRules)) {
      const hash = await digest(normalizePrompt(block.raw));
      const stored = getRecord(id)?.[hash];
      if (stored && !document.querySelector(`.sf-inline-action[data-sf-id="${stored.id}"]`)) scheduleInlineAction({ ...stored, matched: block.matched, ruleName: block.ruleName, status: "pending" });
    }
  }
  for (const node of document.querySelectorAll(".mes[mesid], [data-message-id], [data-mesid]")) {
    const id = node.getAttribute("mesid") ?? node.getAttribute("data-message-id") ?? node.getAttribute("data-mesid");
    if (id == null) continue;
    const textNode = node.querySelector(".mes_text, .message_text, .mes_content") || node;
    count += (await inspectMessage({ message_id: Number.isNaN(Number(id)) ? id : Number(id), mes: textNode.textContent || "" })).length;
  }
  return count;
}
function scheduleInlineAction(item, attempt = 0) {
  if (item.messageId == null) return;
  const attached = renderGenerateAction({ messageId: item.messageId, item, onGenerate: enqueueItem, onDismiss: dismissItem });
  if (!attached && attempt < 12) setTimeout(() => scheduleInlineAction(item, attempt + 1), 250);
}
function scheduleChatScan(delay = 350) {
  clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(() => scanChatForImageBlocks().catch((error) => console.debug("[SceneFrame] auto scan error", error)), delay);
}
function currentChatKey() {
  const context = getTavernContext();
  return String(context?.chatId || context?.chat_id || context?.characterId || context?.name2 || location.hash || "default");
}
function watchChatChanges() {
  let lastNodeCount = 0;
  const observer = new MutationObserver(() => {
    const key = currentChatKey(), nodes = document.querySelectorAll(".mes[mesid], [data-message-id], [data-mesid]").length;
    const chatChanged = key !== state.lastChatKey;
    if (chatChanged || nodes !== lastNodeCount) {
      state.lastChatKey = key;
      lastNodeCount = nodes;
      scheduleChatScan(chatChanged ? 650 : 220);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  state.domObserver = observer;
}
function diagnostics() {
  const context = window.SillyTavern?.getContext?.() || window.getContext?.() || null;
  return { version: "0.1.0", eventSource: Boolean(window.eventSource?.on), eventOn: typeof window.eventOn === "function" || typeof context?.eventOn === "function", chatMessages: (context?.chat || window.chat || []).length, messageNodes: document.querySelectorAll(".mes,[mesid],[data-message-id]").length, pending: state.pending.length, queued: state.tasks.filter((x) => x.status === "queued").length };
}
function inspectChatMessageById(id) {
  const messageId = Number(id);
  const message = getChatMessages()?.[messageId];
  if (!message || typeof message.mes !== "string") return;
  inspectMessage({ ...message, message_id: messageId }).catch((error) => console.debug("[SceneFrame] native inspect error", error));
}
function boot() {
  try {
    render();
    const source = getNativeEvents(), types = getNativeEventTypes();
    if (source?.on) {
      for (const key of ["MESSAGE_RECEIVED", "MESSAGE_EDITED", "MESSAGE_UPDATED"]) {
        const type = types[key];
        if (type) source.on(type, (id) => {
          inspectChatMessageById(id);
          scheduleChatScan(260);
        });
      }
      for (const key of ["GENERATION_ENDED", "MESSAGE_SWIPED", "CHAT_CHANGED", "CHAT_LOADED"]) {
        const type = types[key];
        if (type) source.on(type, () => scheduleChatScan(500));
      }
    }
    state.unsubscribe = subscribeToMessages((message) => {
      inspectMessage(message).catch((error) => console.debug("[SceneFrame] fallback inspect error", error));
      scheduleChatScan(260);
    });
    state.lastChatKey = currentChatKey();
    watchChatChanges();
    scheduleChatScan(700);
    window.SceneFrame = { state, queue, inspectMessage, scanChatForImageBlocks, generate, diagnostics, extractByRules, normalizePrompt };
    console.info("[SceneFrame] loaded safely", diagnostics());
  } catch (error) {
    console.error("[SceneFrame] boot error", error);
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
