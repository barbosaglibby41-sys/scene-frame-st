function esc(value) { return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
export function findMessageElement(messageId) {
  const id = String(messageId ?? ''); if (!id) return null; const safe = esc(id);
  const selectors = [`[mesid="${safe}"]`, `[data-message-id="${safe}"]`, `[data-mesid="${safe}"]`, `.mes[mesid="${safe}"]`, `#chat .mes:nth-child(${Number.isInteger(Number(id)) ? Number(id) + 1 : 0})`];
  return selectors.filter(s => !s.includes('nth-child(0)')).map(s => { try { return document.querySelector(s); } catch { return null; } }).find(Boolean) || null;
}
function messageTextRoot(messageId) {
  const root = findMessageElement(messageId); if (!root) return null;
  return root.querySelector('.mes_text, .message_text, .mes_content') || root;
}
function cardMarkup(item) {
  const status = item.status || 'pending';
  const label = status === 'generating' ? '正在生成…' : status === 'queued' ? '已加入队列…' : status === 'failed' ? '重新生成图片' : status === 'completed' ? '图片已生成' : '生成图片';
  const disabled = ['generating', 'queued', 'completed'].includes(status);
  return `<button class="sf-inline-generate ${status === 'generating' || status === 'queued' ? 'sf-loading' : ''} ${status === 'failed' ? 'sf-generate-failed' : ''}" ${disabled ? 'disabled' : ''} title="长按查看原始 Tag">${status === 'generating' || status === 'queued' ? '<span class="sf-spinner"></span>' : '🖼️'} ${label}</button>${status === 'failed' ? `<span class="sf-inline-error" title="${esc(item.error || '请检查 API 设置')}">!</span>` : ''}`;
}
function openTagPreview(item) {
  document.querySelector('#sf-tag-preview-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'sf-tag-preview-modal'; modal.className = 'sf-tag-modal';
  const raw = item.matched || item.prompt || '';
  modal.innerHTML = `<div class="sf-tag-modal-card" role="dialog" aria-modal="true"><div class="sf-tag-modal-head"><b>原始图片 Tag</b><button aria-label="关闭">×</button></div><pre></pre><div class="sf-tag-modal-actions"><button data-copy>复制 Tag</button><button data-close>关闭</button></div></div>`;
  modal.querySelector('pre').textContent = raw; const close = () => modal.remove();
  modal.querySelector('[aria-label="关闭"]').onclick = close; modal.querySelector('[data-close]').onclick = close;
  modal.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(raw); } catch {} };
  modal.addEventListener('click', event => { if (event.target === modal) close(); }); document.body.append(modal);
}
function bindCard(card, item, onGenerate) {
  const generate = card.querySelector('.sf-inline-generate'); let pressTimer = null, longPressed = false;
  generate?.addEventListener('pointerdown', () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; openTagPreview(item); }, 550); });
  for (const event of ['pointerup', 'pointercancel', 'pointerleave']) generate?.addEventListener(event, () => { clearTimeout(pressTimer); });
  generate?.addEventListener('click', event => { if (longPressed) { event.preventDefault(); event.stopImmediatePropagation(); return; } onGenerate?.(item); });
}
export function renderGenerateAction({ messageId, item, onGenerate, onDismiss }) {
  const root = messageTextRoot(messageId); if (!root) return false; const id = String(item.id);
  let card = root.querySelector(`.sf-inline-action[data-sf-id="${esc(id)}"]`);
  if (!card) {
    const wanted = String(item.matched || ''); const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode())) { const at = node.nodeValue.indexOf(wanted); if (at < 0) continue;
      const before = node.nodeValue.slice(0, at), after = node.nodeValue.slice(at + wanted.length);
      card = document.createElement('span'); card.className = 'sf-inline-action'; card.dataset.sfId = id;
      node.parentNode.insertBefore(document.createTextNode(before), node); node.parentNode.insertBefore(card, node); node.parentNode.insertBefore(document.createTextNode(after), node); node.remove(); break;
    }
    if (!card) return false;
  }
  card.innerHTML = cardMarkup(item); bindCard(card, item, onGenerate); return true;
}
export function insertImageBelowMessage({ messageId, blob, prompt }) {
  const target = findMessageElement(messageId); const url = URL.createObjectURL(blob); if (!target) return { inserted: false, url };
  const box = target.querySelector?.('.sf-image-list') || (() => { const x = document.createElement('div'); x.className = 'sf-image-list'; target.append(x); return x; })();
  const figure = document.createElement('figure'); figure.className = 'sf-image-item'; const img = document.createElement('img'); img.src = url; img.alt = prompt || 'SceneFrame'; img.loading = 'lazy'; img.title = prompt || ''; figure.append(img);
  const action = target.querySelector('.sf-inline-action'); if (action) action.insertAdjacentElement('afterend', figure); else box.append(figure);
  return { inserted: true, url };
}
