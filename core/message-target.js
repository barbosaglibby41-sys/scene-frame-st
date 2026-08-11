function esc(value) { return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
export function findMessageElement(messageId) {
  const id = String(messageId ?? ''); if (!id) return null; const safe = esc(id);
  const selectors = [`[mesid="${safe}"]`, `[data-message-id="${safe}"]`, `[data-mesid="${safe}"]`, `.mes[mesid="${safe}"]`, `#chat .mes:nth-child(${Number.isInteger(Number(id)) ? Number(id) + 1 : 0})`];
  return selectors.filter(s => !s.includes('nth-child(0)')).map(s => { try { return document.querySelector(s); } catch { return null; } }).find(Boolean) || null;
}
function messageTextRoot(messageId) { const root = findMessageElement(messageId); return root?.querySelector('.mes_text, .message_text, .mes_content') || root || null; }
function collectLogicalText(root) {
  const infos = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) return node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    const parent = node.parentElement;
    if (!node.nodeValue || parent?.closest('.sf-inline-action, button, script, style')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  } });
  let text = '', node; while ((node = walker.nextNode())) { const start = text.length, value = node.nodeType === Node.TEXT_NODE ? node.nodeValue : '\n'; text += value; infos.push({ node, start, end: text.length, value }); }
  return { text, infos };
}
function boundaryAt(infos, position, isEnd = false) {
  for (const info of infos) if (position >= info.start && position <= info.end) {
    if (info.node.nodeType === Node.TEXT_NODE) return { node: info.node, offset: Math.max(0, Math.min(info.node.nodeValue.length, position - info.start)) };
    const parent = info.node.parentNode, index = [...parent.childNodes].indexOf(info.node); return { node: parent, offset: index + (isEnd ? 1 : 0) };
  }
  return null;
}
function findMatchRange(root, matched) {
  const { text, infos } = collectLogicalText(root); const wanted = String(matched || ''); let start = text.indexOf(wanted);
  if (start < 0) {
    const marker = wanted.match(/^(.*?)(?:[\r\n]|$)/)?.[1]?.trim() || ''; if (marker) start = text.indexOf(marker);
    if (start >= 0) { const endMarker = wanted.slice(wanted.lastIndexOf('###')); const end = endMarker ? text.indexOf(endMarker, start + marker.length) : -1; if (end >= 0) return { start, end: end + endMarker.length, infos }; }
    return null;
  }
  return { start, end: start + wanted.length, infos };
}
function openTagPreview(item) {
  document.querySelector('#sf-tag-preview-modal')?.remove(); const modal = document.createElement('div'); modal.id = 'sf-tag-preview-modal'; modal.className = 'sf-tag-modal'; const raw = item.matched || item.prompt || '';
  modal.innerHTML = `<div class="sf-tag-modal-card" role="dialog" aria-modal="true"><div class="sf-tag-modal-head"><b>原始图片 Tag</b><button aria-label="关闭">×</button></div><pre></pre><div class="sf-tag-modal-actions"><button data-copy>复制 Tag</button><button data-close>关闭</button></div></div>`;
  modal.querySelector('pre').textContent = raw; const close = () => modal.remove(); modal.querySelector('[aria-label="关闭"]').onclick = close; modal.querySelector('[data-close]').onclick = close; modal.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(raw); } catch {} }; modal.addEventListener('click', event => { if (event.target === modal) close(); }); document.body.append(modal);
}
function updateButton(button, item) {
  const status = item.status || 'pending'; const loading = status === 'generating' || status === 'queued'; const failed = status === 'failed';
  const label = status === 'generating' ? '生成中…' : status === 'queued' ? '排队中…' : failed ? '重新生成图片' : status === 'completed' ? '图片已生成' : '生成图片';
  button.disabled = loading || status === 'completed'; button.classList.toggle('sf-loading', loading); button.classList.toggle('sf-generate-failed', failed);
  button.innerHTML = `${loading ? '<span class="sf-spinner"></span>' : '🖼️'} ${label}`; button.title = failed ? `生成失败：${item.error || '未知错误'}；长按查看原始 Tag` : '长按查看原始 Tag';
}
function bindButton(button, item, onGenerate) {
  let timer = null, longPressed = false;
  button.addEventListener('pointerdown', () => { longPressed = false; timer = setTimeout(() => { longPressed = true; openTagPreview(item); }, 550); });
  for (const event of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(event, () => clearTimeout(timer));
  button.addEventListener('click', event => { if (longPressed) { event.preventDefault(); event.stopImmediatePropagation(); return; } onGenerate?.(item); });
}
export function renderGenerateAction({ messageId, item, onGenerate }) {
  const root = messageTextRoot(messageId); if (!root) return false; const id = String(item.id); let button = root.querySelector(`button.sf-inline-action[data-sf-id="${esc(id)}"]`);
  if (!button) {
    const hit = findMatchRange(root, item.matched); if (!hit) return false; const start = boundaryAt(hit.infos, hit.start), end = boundaryAt(hit.infos, hit.end, true); if (!start || !end) return false;
    const range = document.createRange(); try { range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset); button = document.createElement('button'); button.type = 'button'; button.className = 'image-tag-button st-chatu8-image-button sf-inline-action'; button.dataset.sfId = id; range.deleteContents(); range.insertNode(button); } catch { return false; }
    bindButton(button, item, onGenerate);
  }
  updateButton(button, item); return true;
}
export function insertImageBelowMessage({ messageId, blob, prompt }) {
  const target = findMessageElement(messageId), url = URL.createObjectURL(blob); if (!target) return { inserted: false, url };
  const figure = document.createElement('figure'); figure.className = 'sf-image-item'; const img = document.createElement('img'); img.src = url; img.alt = prompt || 'SceneFrame'; img.loading = 'lazy'; img.title = prompt || ''; figure.append(img);
  const action = target.querySelector('.sf-inline-action'); if (action) action.insertAdjacentElement('afterend', figure); else target.append(figure); return { inserted: true, url };
}
