import { extractImageBlocks, normalizePrompt, digest } from './core/tag-parser.js';
import { TaskQueue } from './core/task-queue.js';
import { generateNAI } from './adapters/nai.js';
import { generateSD } from './adapters/sd-webui.js';
import { insertImageBelowMessage } from './core/message-target.js';
import { putImage } from './core/cache.js';
import { subscribeToMessages } from './core/event-bridge.js';
import { hasBlock, rememberBlock } from './core/message-store.js';

const KEY = 'scene_frame_settings';
const defaults = { enabled: true, autoGenerate: false, backend: 'sd', naiKey: '', naiUrl: 'https://image.novelai.net', sdUrl: 'http://127.0.0.1:7860', negative: '', width: 768, height: 1024, steps: 28 };
const state = { settings: { ...defaults }, seen: new Set(), current: null, pending: [], tasks: [], fabDragged: false };
try { Object.assign(state.settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
function save() { localStorage.setItem(KEY, JSON.stringify(state.settings)); }
function val(sel) { return document.querySelector(sel)?.value ?? ''; }
function setStatus(text) { const el = document.querySelector('#sf-status'); if (el) el.textContent = text; }

async function generate(item) {
  const s = state.settings;
  setStatus(`⏳ 正在使用 ${s.backend === 'nai' ? 'NovelAI' : 'A1111/Forge'} 生成…`);
  const result = s.backend === 'nai'
    ? await generateNAI({ apiKey: s.naiKey, baseUrl: s.naiUrl, prompt: item.prompt, negativePrompt: s.negative, width: Number(s.width), height: Number(s.height), steps: Number(s.steps) })
    : await generateSD({ baseUrl: s.sdUrl, prompt: item.prompt, negativePrompt: s.negative, width: Number(s.width), height: Number(s.height), steps: Number(s.steps) });
  await putImage({ id: item.id, messageId: item.messageId ?? null, prompt: item.prompt, blob: result.blob, createdAt: Date.now(), backend: result.backend });
  const inserted = item.messageId == null ? false : insertImageBelowMessage({ messageId: item.messageId, blob: result.blob, prompt: item.prompt }).inserted;
  state.pending = state.pending.filter(x => x.id !== item.id);
  setStatus(`✅ 生成完成${inserted ? '，已尝试插入消息' : ''}`); renderPending();
  return result;
}
const queue = new TaskQueue({ onChange: tasks => { state.tasks = tasks; renderPending(); console.debug('[SceneFrame]', tasks); } });
function addPending(item) { state.pending = [...state.pending.filter(x => x.id !== item.id), item]; state.current = item; renderPending(); }
function renderPending() {
  const box = document.querySelector('#sf-detected'); if (!box) return;
  box.innerHTML = state.pending.length ? state.pending.map(item => `<article class="sf-detected-card" data-id="${item.id}"><div class="sf-detected-head"><b>🖼️ 图片块</b><span>${item.messageId == null ? '未绑定楼层' : `楼层 ${item.messageId}`}</span></div><div class="sf-preview">${escapeHtml(item.prompt)}</div><div class="sf-row"><button data-pending="generate">生成</button><button data-pending="edit">编辑</button><button data-pending="dismiss">忽略</button></div></article>`).join('') : '<div class="sf-empty">尚未检测到新的图片块</div>';
  box.querySelectorAll('[data-pending]').forEach(btn => btn.onclick = async () => {
    const item = state.pending.find(x => x.id === btn.closest('[data-id]').dataset.id); if (!item) return;
    if (btn.dataset.pending === 'generate') { if (!queue.add({ ...item, run: generate })) setStatus('该图片块已在队列中'); }
    if (btn.dataset.pending === 'edit') { document.querySelector('#sf-prompt').value = item.prompt; state.current = item; setStatus('已载入编辑框'); }
    if (btn.dataset.pending === 'dismiss') { state.pending = state.pending.filter(x => x.id !== item.id); renderPending(); setStatus('已忽略该图片块'); }
  });
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function placeFab(fab) {
  const pos = state.settings.fabPosition;
  if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
    fab.style.left = `${clamp(pos.left, 8, innerWidth - 58)}px`;
    fab.style.top = `${clamp(pos.top, 8, innerHeight - 58)}px`;
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
  }
}
function makeFabDraggable(fab) {
  let startX = 0, startY = 0, left = 0, top = 0, dragging = false;
  fab.addEventListener('pointerdown', event => {
    if (event.button != null && event.button !== 0) return;
    const rect = fab.getBoundingClientRect(); startX = event.clientX; startY = event.clientY; left = rect.left; top = rect.top; dragging = false;
    fab.setPointerCapture?.(event.pointerId); fab.classList.add('sf-grabbing');
  });
  fab.addEventListener('pointermove', event => {
    if (!fab.hasPointerCapture?.(event.pointerId)) return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragging = true;
    if (!dragging) return;
    const x = clamp(left + dx, 8, innerWidth - fab.offsetWidth - 8), y = clamp(top + dy, 8, innerHeight - fab.offsetHeight - 8);
    fab.style.left = `${x}px`; fab.style.top = `${y}px`; fab.style.right = 'auto'; fab.style.bottom = 'auto';
  });
  const finish = event => {
    if (!fab.hasPointerCapture?.(event.pointerId)) return;
    fab.releasePointerCapture?.(event.pointerId); fab.classList.remove('sf-grabbing');
    if (dragging) { const rect = fab.getBoundingClientRect(); state.settings.fabPosition = { left: Math.round(rect.left), top: Math.round(rect.top) }; state.fabDragged = true; save(); }
  };
  fab.addEventListener('pointerup', finish); fab.addEventListener('pointercancel', finish);
}
function render() {
  document.querySelector('#scene-frame-root')?.remove();
  const root = document.createElement('div'); root.id = 'scene-frame-root';
  root.innerHTML = `<button class="sf-fab" title="SceneFrame">🖼️</button><section class="sf-sheet sf-hidden"><div class="sf-title"><b>镜匣 SceneFrame</b><button data-act="close" aria-label="关闭">×</button></div><div class="sf-row"><select id="sf-backend" class="sf-input"><option value="sd">A1111 / Forge</option><option value="nai">NovelAI</option></select><button data-act="toggle">自动：${state.settings.autoGenerate ? '开' : '关'}</button></div><div class="sf-section-title">检测到的图片块</div><div id="sf-detected"></div><div class="sf-section-title">Prompt 编辑</div><input id="sf-url" class="sf-input" placeholder="后端地址"><input id="sf-key" class="sf-input" type="password" placeholder="NovelAI API Key（仅本地）"><textarea id="sf-prompt" class="sf-textarea" placeholder="手动输入或粘贴 prompt"></textarea><input id="sf-negative" class="sf-input" placeholder="负面提示词"><div class="sf-row"><button data-act="generate">生成</button><button data-act="clear">清空</button></div><div id="sf-status" class="sf-status">v0.1.0 · 手动确认模式</div></section>`;
  document.body.append(root);
  const sheet = root.querySelector('.sf-sheet');
  const fab = root.querySelector('.sf-fab'); placeFab(fab); makeFabDraggable(fab);
  root.querySelector('#sf-backend').value = state.settings.backend;
  root.querySelector('#sf-url').value = state.settings.backend === 'nai' ? state.settings.naiUrl : state.settings.sdUrl;
  root.querySelector('#sf-negative').value = state.settings.negative;
  fab.onclick = () => { if (state.fabDragged) { state.fabDragged = false; return; } sheet.classList.toggle('sf-hidden'); renderPending(); };
  root.querySelector('[data-act=close]').onclick = () => sheet.classList.add('sf-hidden');
  renderPending();
  root.querySelector('[data-act=toggle]').onclick = () => { state.settings.autoGenerate = !state.settings.autoGenerate; save(); render(); };
  root.querySelector('#sf-backend').onchange = e => { state.settings.backend = e.target.value; save(); render(); };
  root.querySelector('#sf-url').onchange = e => { if (state.settings.backend === 'nai') state.settings.naiUrl = e.target.value; else state.settings.sdUrl = e.target.value; save(); };
  root.querySelector('#sf-key').onchange = e => { state.settings.naiKey = e.target.value; save(); };
  root.querySelector('#sf-negative').onchange = e => { state.settings.negative = e.target.value; save(); };
  root.querySelector('[data-act=clear]').onclick = () => { root.querySelector('#sf-prompt').value = ''; state.current = null; };
  root.querySelector('[data-act=generate]').onclick = async () => {
    const prompt = normalizePrompt(val('#sf-prompt')); if (!prompt) return setStatus('请输入 prompt');
    const hash = await digest(prompt);
    const base = state.current || {};
    const item = { id: crypto.randomUUID(), hash, prompt, messageId: base.messageId ?? null };
    if (!queue.add({ ...item, run: generate })) setStatus('该 prompt 已在任务队列中');
  };
}
async function inspectMessage(message) {
  if (!state.settings.enabled) return [];
  const text = typeof message === 'string' ? message : (message?.mes || message?.message || ''); const found = [];
  const messageId = message?.message_id ?? message?.id ?? message?.mesid ?? null;
  for (const block of extractImageBlocks(text)) {
    const prompt = normalizePrompt(block.raw), hash = await digest(prompt);
    if (state.seen.has(hash) || hasBlock(messageId, hash)) continue;
    state.seen.add(hash);
    const item = { id: crypto.randomUUID(), hash, prompt, messageId };
    rememberBlock(messageId, hash, item); found.push(item);
    if (state.settings.autoGenerate) queue.add({ ...item, run: generate });
    else { addPending(item); setStatus('🖼️ 检测到图片块，已准备手动生成'); }
  }
  return found;
}
function diagnostics() {
  const context = window.SillyTavern?.getContext?.() || window.getContext?.() || null;
  return { version: '0.1.0', eventSource: Boolean(window.eventSource?.on), eventOn: typeof window.eventOn === 'function' || typeof context?.eventOn === 'function', chatMessages: (context?.chat || window.chat || []).length, messageNodes: document.querySelectorAll('.mes,[mesid],[data-message-id]').length, pending: state.pending.length, queued: state.tasks.filter(x => x.status === 'queued').length };
}
function boot() {
  render();
  state.unsubscribe = subscribeToMessages(message => inspectMessage(message).catch(error => console.debug('[SceneFrame] inspect error', error)));
  window.SceneFrame = { state, queue, inspectMessage, generate, diagnostics, extractImageBlocks, normalizePrompt };
  console.info('[SceneFrame] loaded independently with message bridge', diagnostics());
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
