import { extractImageBlocks, normalizePrompt, digest } from './core/tag-parser.js';
import { TaskQueue } from './core/task-queue.js';
import { generateNAI } from './adapters/nai.js';
import { generateSD } from './adapters/sd-webui.js';
import { searchDanbooruTags, DANBOORU_CATEGORY } from './adapters/danbooru.js';
import { insertImageBelowMessage } from './core/message-target.js';
import { putImage } from './core/cache.js';
import { subscribeToMessages } from './core/event-bridge.js';
import { hasBlock, rememberBlock } from './core/message-store.js';

const KEY = 'scene_frame_settings';
const defaults = { enabled: true, autoGenerate: false, backend: 'sd', naiKey: '', naiUrl: 'https://image.novelai.net', naiModel: 'nai-diffusion-4-5-full', naiSampler: 'k_euler', naiScale: 5, naiSeed: -1, naiSamples: 1, naiUcPreset: 2, naiQualityToggle: true, naiSmea: false, naiSmeaDyn: false, naiWidth: 832, naiHeight: 1216, naiSteps: 28, sdUrl: 'http://127.0.0.1:7860', danbooruLogin: '', danbooruKey: '', danbooruUrl: 'https://danbooru.donmai.us', positivePrefix: '', negative: '', presets: [], activePresetId: '', width: 768, height: 1024, steps: 28 };
const state = { settings: { ...defaults }, seen: new Set(), current: null, pending: [], tasks: [], fabDragged: false, page: 'generate', panelOpen: false, panelScrollTop: 0 };
try { Object.assign(state.settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
function save() { localStorage.setItem(KEY, JSON.stringify(state.settings)); }
function val(sel) { return document.querySelector(sel)?.value ?? ''; }
function setStatus(text) { const el = document.querySelector('#sf-status'); if (el) el.textContent = text; }
function readControl(id, fallback = '') { return document.querySelector(`#${id}`)?.value ?? fallback; }
function saveAllSettings() {
  const s = state.settings;
  s.backend = readControl('sf-backend', s.backend); s.naiUrl = readControl('sf-url', s.naiUrl); s.naiKey = readControl('sf-key', s.naiKey);
  s.positivePrefix = readControl('sf-prefix', s.positivePrefix); s.negative = readControl('sf-negative', s.negative);
  s.naiModel = readControl('sf-nai-model', s.naiModel); s.naiSampler = readControl('sf-nai-sampler', s.naiSampler);
  for (const [key, id] of Object.entries({ naiScale:'sf-nai-scale', naiSeed:'sf-nai-seed', naiSamples:'sf-nai-samples', naiUcPreset:'sf-nai-ucpreset', naiWidth:'sf-nai-width', naiHeight:'sf-nai-height', naiSteps:'sf-nai-steps' })) s[key] = Number(readControl(id, s[key]));
  const quality = document.querySelector('#sf-nai-quality'), smea = document.querySelector('#sf-nai-smea'), smeaDyn = document.querySelector('#sf-nai-smeadyn');
  if (quality) s.naiQualityToggle = quality.checked; if (smea) s.naiSmea = smea.checked; if (smeaDyn) s.naiSmeaDyn = smeaDyn.checked;
  s.danbooruLogin = readControl('sf-danbooru-login', s.danbooruLogin).trim(); s.danbooruKey = readControl('sf-danbooru-key', s.danbooruKey).trim();
  save(); setStatus('✅ 已保存全部设置到本机');
}
function composePrompt(scenePrompt = '') { return normalizePrompt([state.settings.positivePrefix, scenePrompt].filter(Boolean).join(', ')); }
function presetById(id) { return (state.settings.presets || []).find(x => x.id === id) || null; }
function applyPreset(id) {
  const preset = presetById(id); if (!preset) return;
  state.settings.positivePrefix = preset.positivePrefix || '';
  state.settings.negative = preset.negative || '';
  // 方案只管前置/负面提示词，不覆盖后端、API 或任何生成参数。
  state.settings.activePresetId = preset.id; save();
}

async function generate(item) {
  const s = state.settings, fullPrompt = composePrompt(item.prompt);
  setStatus(`⏳ 正在使用 ${s.backend === 'nai' ? 'NovelAI' : 'A1111/Forge'} 生成…`);
  const result = s.backend === 'nai'
    ? await generateNAI({ apiKey: s.naiKey, baseUrl: s.naiUrl, model: s.naiModel, sampler: s.naiSampler, scale: Number(s.naiScale), seed: Number(s.naiSeed), nSamples: Number(s.naiSamples), ucPreset: Number(s.naiUcPreset), qualityToggle: Boolean(s.naiQualityToggle), smea: Boolean(s.naiSmea), smeaDyn: Boolean(s.naiSmeaDyn), prompt: fullPrompt, negativePrompt: s.negative, width: Number(s.naiWidth), height: Number(s.naiHeight), steps: Number(s.naiSteps) })
    : await generateSD({ baseUrl: s.sdUrl, prompt: fullPrompt, negativePrompt: s.negative, width: Number(s.width), height: Number(s.height), steps: Number(s.steps) });
  await putImage({ id: item.id, messageId: item.messageId ?? null, prompt: fullPrompt, blob: result.blob, createdAt: Date.now(), backend: result.backend });
  const inserted = item.messageId == null ? false : insertImageBelowMessage({ messageId: item.messageId, blob: result.blob, prompt: fullPrompt }).inserted;
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
function appendTagsToPrompt(tags) {
  const field = document.querySelector('#sf-prompt'); if (!field) return;
  field.value = normalizePrompt([field.value, ...tags].filter(Boolean).join(', '));
}
function renderDanbooruResults(rows = []) {
  const box = document.querySelector('#sf-danbooru-results'); if (!box) return;
  box.innerHTML = rows.length ? rows.map(tag => `<button class="sf-tag" data-tag="${escapeHtml(tag.name)}" title="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}<small>${DANBOORU_CATEGORY[tag.category] || '其他'} · ${tag.postCount.toLocaleString()}</small></button>`).join('') : '<div class="sf-empty">输入英文 tag 搜索；点击结果加入动态图片提示词</div>';
  box.querySelectorAll('[data-tag]').forEach(button => button.onclick = () => { appendTagsToPrompt([button.dataset.tag]); setStatus(`已加入 tag：${button.dataset.tag}`); });
}
async function runDanbooruSearch() {
  const query = val('#sf-danbooru-query').trim(); if (!query) return setStatus('请输入要搜索的 Danbooru tag');
  const button = document.querySelector('[data-act=search-danbooru]'); if (button) button.disabled = true;
  try {
    setStatus('⏳ 正在查询 Danbooru 标签…');
    const rows = await searchDanbooruTags({ query, login: state.settings.danbooruLogin, apiKey: state.settings.danbooruKey, baseUrl: state.settings.danbooruUrl });
    renderDanbooruResults(rows); setStatus(`✅ Danbooru 返回 ${rows.length} 个标签`);
  } catch (error) { setStatus(`⚠️ Danbooru 查询失败：${error.message || error}`); renderDanbooruResults([]); }
  finally { if (button) button.disabled = false; }
}
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
  let startX = 0, startY = 0, left = 0, top = 0, dragging = false, activeId = null;
  const move = event => {
    if (activeId == null || event.pointerId !== activeId) return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragging = true;
    if (!dragging) return;
    const x = clamp(left + dx, 8, innerWidth - fab.offsetWidth - 8), y = clamp(top + dy, 8, innerHeight - fab.offsetHeight - 8);
    fab.style.left = `${x}px`; fab.style.top = `${y}px`; fab.style.right = 'auto'; fab.style.bottom = 'auto';
  };
  const finish = event => {
    if (activeId == null || event.pointerId !== activeId) return;
    activeId = null; fab.classList.remove('sf-grabbing');
    if (dragging) { const rect = fab.getBoundingClientRect(); state.settings.fabPosition = { left: Math.round(rect.left), top: Math.round(rect.top) }; state.fabDragged = true; save(); }
  };
  fab.addEventListener('pointerdown', event => {
    if (event.button != null && event.button !== 0) return;
    const rect = fab.getBoundingClientRect(); startX = event.clientX; startY = event.clientY; left = rect.left; top = rect.top; dragging = false; activeId = event.pointerId;
    fab.classList.add('sf-grabbing');
  });
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', finish, { passive: true });
  window.addEventListener('pointercancel', finish, { passive: true });
}
function render() {
  const previousSheet = document.querySelector('#scene-frame-root .sf-sheet');
  if (previousSheet) state.panelScrollTop = previousSheet.scrollTop;
  document.querySelector('#scene-frame-root')?.remove();
  const root = document.createElement('div'); root.id = 'scene-frame-root';
  root.innerHTML = `<button class="sf-fab" title="SceneFrame">🖼️</button><section class="sf-sheet ${state.panelOpen ? '' : 'sf-hidden'}"><div class="sf-title"><b>镜匣 SceneFrame</b><button data-act="close" aria-label="关闭">×</button></div><div class="sf-row"><select id="sf-backend" class="sf-input"><option value="sd">A1111 / Forge</option><option value="nai">NovelAI</option></select><button data-act="toggle">自动：${state.settings.autoGenerate ? '开' : '关'}</button></div><div class="sf-section-title">提示词方案 · 仅保存前置 / 负面词</div><div class="sf-row"><select id="sf-preset" class="sf-input"><option value="">未选择方案</option></select><button data-act="save-preset">另存方案</button><button data-act="delete-preset">删除</button></div><input id="sf-preset-name" class="sf-input" placeholder="方案名称，例如 NAI·水彩画师串"><div class="sf-section-title">前置提示词 · 画师串 / 固定画风</div><textarea id="sf-prefix" class="sf-textarea sf-short" placeholder="例如：artist:xxx, artist:yyy, watercolor, anime coloring"></textarea><div class="sf-section-title">负面提示词 · 跟随方案保存</div><textarea id="sf-negative" class="sf-textarea sf-short" placeholder="例如：lowres, bad anatomy, bad hands, text"></textarea><nav class="sf-tabs"><button data-page="generate" class="${state.page === 'generate' ? 'sf-tab-active' : ''}">生图</button><button data-page="danbooru" class="${state.page === 'danbooru' ? 'sf-tab-active' : ''}">标签库</button></nav><section class="sf-page ${state.page === 'generate' ? '' : 'sf-hidden'}" data-page-content="generate"><div class="sf-section-title">检测到的图片块</div><div id="sf-detected"></div><div class="sf-section-title">动态图片提示词 · 来自 &lt;image&gt; 标签</div><input id="sf-url" class="sf-input" placeholder="后端地址"><input id="sf-key" class="sf-input" type="password" placeholder="NovelAI API Key（仅本地）"><details class="sf-params" id="sf-nai-params"><summary>NovelAI 参数设置</summary><div class="sf-param-grid"><label>模型<select id="sf-nai-model" class="sf-input"><option value="nai-diffusion-4-5-full">NAI Diffusion 4.5 Full</option><option value="nai-diffusion-4-5-curated-preview">NAI Diffusion 4.5 Curated</option><option value="nai-diffusion-4-curated-preview">NAI Diffusion 4 Curated</option></select></label><label>采样器<select id="sf-nai-sampler" class="sf-input"><option value="k_euler">Euler</option><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option><option value="k_dpmpp_sde">DPM++ SDE</option><option value="k_lms">LMS</option></select></label><label>宽度<input id="sf-nai-width" class="sf-input" type="number" min="64" step="64"></label><label>高度<input id="sf-nai-height" class="sf-input" type="number" min="64" step="64"></label><label>步数<input id="sf-nai-steps" class="sf-input" type="number" min="1" max="50"></label><label>CFG / Scale<input id="sf-nai-scale" class="sf-input" type="number" min="0" max="20" step="0.1"></label><label>Seed（-1 随机）<input id="sf-nai-seed" class="sf-input" type="number" step="1"></label><label>出图数<input id="sf-nai-samples" class="sf-input" type="number" min="1" max="4"></label><label>UC 预设<select id="sf-nai-ucpreset" class="sf-input"><option value="0">0 · 无</option><option value="1">1 · Light</option><option value="2">2 · Heavy</option><option value="3">3 · Human Focus</option></select></label><label class="sf-check"><input id="sf-nai-quality" type="checkbox"> 启用 Quality Toggle</label><label class="sf-check"><input id="sf-nai-smea" type="checkbox"> 启用 SMEA</label><label class="sf-check"><input id="sf-nai-smeadyn" type="checkbox"> 启用 SMEA Dynamic</label></div></details><textarea id="sf-prompt" class="sf-textarea" placeholder="AI 图片块或手动输入的场景 prompt"></textarea><div class="sf-row"><button data-act="generate">生成</button><button data-act="clear">清空场景</button></div></section><section class="sf-page ${state.page === 'danbooru' ? '' : 'sf-hidden'}" data-page-content="danbooru"><div class="sf-section-title">Danbooru 标签库 · 账户配置</div><p class="sf-help">输入账户和 API Key 后，可搜索官方标签；点击标签会加入生图页的动态提示词。</p><input id="sf-danbooru-login" class="sf-input" placeholder="Danbooru 账户名"><input id="sf-danbooru-key" class="sf-input" type="password" placeholder="Danbooru API Key（仅本地保存）"><div class="sf-section-title">搜索标签</div><div class="sf-row"><input id="sf-danbooru-query" class="sf-input" placeholder="英文 tag，例如 blue_hair"><button data-act="search-danbooru">搜索</button></div><div id="sf-danbooru-results" class="sf-tag-results"></div></section><div id="sf-status" class="sf-status">v0.1.8 · 方案仅含前置 / 负面词</div><button class="sf-save-all" data-act="save-all">保存全部设置</button></section>`;
  document.body.append(root);
  const sheet = root.querySelector('.sf-sheet');
  const fab = root.querySelector('.sf-fab'); placeFab(fab); makeFabDraggable(fab);
  requestAnimationFrame(() => { sheet.scrollTop = Math.min(state.panelScrollTop, sheet.scrollHeight); });
  root.querySelector('#sf-backend').value = state.settings.backend;
  const urlInput = root.querySelector('#sf-url'); if (urlInput) urlInput.value = state.settings.backend === 'nai' ? state.settings.naiUrl : state.settings.sdUrl;
  root.querySelector('#sf-prefix').value = state.settings.positivePrefix;
  const negativeInput = root.querySelector('#sf-negative'); if (negativeInput) negativeInput.value = state.settings.negative;
  const naiFields = { 'sf-nai-model':'naiModel', 'sf-nai-sampler':'naiSampler', 'sf-nai-width':'naiWidth', 'sf-nai-height':'naiHeight', 'sf-nai-steps':'naiSteps', 'sf-nai-scale':'naiScale', 'sf-nai-seed':'naiSeed', 'sf-nai-samples':'naiSamples', 'sf-nai-ucpreset':'naiUcPreset' };
  for (const [id, key] of Object.entries(naiFields)) { const input = root.querySelector(`#${id}`); if (input) input.value = state.settings[key]; }
  const qualityInput = root.querySelector('#sf-nai-quality'); if (qualityInput) qualityInput.checked = state.settings.naiQualityToggle;
  const smeaInput = root.querySelector('#sf-nai-smea'); if (smeaInput) smeaInput.checked = state.settings.naiSmea;
  const smeaDynInput = root.querySelector('#sf-nai-smeadyn'); if (smeaDynInput) smeaDynInput.checked = state.settings.naiSmeaDyn;
  const danbooruLogin = root.querySelector('#sf-danbooru-login');
  if (danbooruLogin) { danbooruLogin.value = state.settings.danbooruLogin; renderDanbooruResults(); }
  const presetSelect = root.querySelector('#sf-preset');
  presetSelect.insertAdjacentHTML('beforeend', (state.settings.presets || []).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join(''));
  presetSelect.value = state.settings.activePresetId || '';
  fab.onclick = () => { if (state.fabDragged) { state.fabDragged = false; return; } state.panelOpen = !state.panelOpen; sheet.classList.toggle('sf-hidden', !state.panelOpen); renderPending(); };
  root.querySelector('[data-act=close]').onclick = () => { state.panelOpen = false; sheet.classList.add('sf-hidden'); };
  renderPending();
  root.querySelector('[data-act=toggle]').onclick = () => { state.settings.autoGenerate = !state.settings.autoGenerate; save(); render(); };
  root.querySelector('#sf-backend').onchange = e => { saveAllSettings(); state.settings.backend = e.target.value; save(); render(); };
  root.querySelector('#sf-url')?.addEventListener('change', e => { if (state.settings.backend === 'nai') state.settings.naiUrl = e.target.value; else state.settings.sdUrl = e.target.value; save(); });
  root.querySelector('#sf-key')?.addEventListener('change', e => { state.settings.naiKey = e.target.value; save(); });
  root.querySelector('#sf-prefix')?.addEventListener('change', e => { state.settings.positivePrefix = e.target.value; state.settings.activePresetId = ''; save(); });
  root.querySelector('#sf-negative')?.addEventListener('change', e => { state.settings.negative = e.target.value; state.settings.activePresetId = ''; save(); });
  root.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { state.page = button.dataset.page; render(); });
  root.querySelector('#sf-danbooru-login')?.addEventListener('change', e => { state.settings.danbooruLogin = e.target.value.trim(); save(); });
  root.querySelector('#sf-danbooru-key')?.addEventListener('change', e => { state.settings.danbooruKey = e.target.value.trim(); save(); });
  root.querySelector('[data-act=search-danbooru]')?.addEventListener('click', runDanbooruSearch);
  root.querySelector('#sf-danbooru-query')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); runDanbooruSearch(); } });
  presetSelect.onchange = e => { if (!e.target.value) return; applyPreset(e.target.value); render(); setStatus('已切换提示词方案'); };
  root.querySelector('[data-act=save-preset]').onclick = () => {
    const name = val('#sf-preset-name').trim(); if (!name) return setStatus('请先填写方案名称');
    const existing = presetById(state.settings.activePresetId);
    const preset = { id: existing?.id || crypto.randomUUID(), name, positivePrefix: val('#sf-prefix'), negative: val('#sf-negative') };
    state.settings.presets = existing ? state.settings.presets.map(x => x.id === preset.id ? preset : x) : [...(state.settings.presets || []), preset];
    state.settings.activePresetId = preset.id; state.settings.positivePrefix = preset.positivePrefix; state.settings.negative = preset.negative; save(); render(); setStatus(`已保存方案：${name}`);
  };
  root.querySelector('[data-act=delete-preset]').onclick = () => {
    const id = state.settings.activePresetId; if (!id) return setStatus('请先选择要删除的方案');
    const name = presetById(id)?.name || ''; state.settings.presets = state.settings.presets.filter(x => x.id !== id); state.settings.activePresetId = ''; save(); render(); setStatus(`已删除方案：${name}`);
  };
  root.querySelector('[data-act=clear]').onclick = () => { root.querySelector('#sf-prompt').value = ''; state.current = null; };
  root.querySelector('[data-act=save-all]').onclick = saveAllSettings;
  root.querySelector('[data-act=generate]').onclick = async () => {
    saveAllSettings();
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
