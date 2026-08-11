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
  return `<div class="sf-wrap-head"><span>🖼️ 图片生成请求</span><span class="sf-wrap-rule">${item.ruleName || '图片块'}</span></div><div class="sf-wrap-actions"><button class="sf-inline-generate ${status === 'generating' || status === 'queued' ? 'sf-loading' : ''}" ${disabled ? 'disabled' : ''}>${status === 'generating' || status === 'queued' ? '<span class="sf-spinner"></span>' : '🖼️'} ${label}</button>${status === 'pending' ? '<button class="sf-inline-dismiss" title="忽略">×</button>' : ''}</div>${status === 'failed' ? `<div class="sf-inline-error">生成失败：${esc(item.error || '请检查 API 设置')}</div>` : ''}<details class="sf-wrap-detail"><summary>查看解析标签</summary><pre></pre></details>`;
}
function bindCard(card, item, onGenerate, onDismiss) {
  card.querySelector('.sf-wrap-detail pre').textContent = item.prompt || '';
  card.querySelector('.sf-inline-generate')?.addEventListener('click', () => onGenerate?.(item));
  card.querySelector('.sf-inline-dismiss')?.addEventListener('click', () => { card.replaceWith(document.createTextNode(item.matched || '')); onDismiss?.(item); });
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
  card.innerHTML = cardMarkup(item); bindCard(card, item, onGenerate, onDismiss); return true;
}
export function insertImageBelowMessage({ messageId, blob, prompt }) {
  const target = findMessageElement(messageId); const url = URL.createObjectURL(blob); if (!target) return { inserted: false, url };
  const box = target.querySelector?.('.sf-image-list') || (() => { const x = document.createElement('div'); x.className = 'sf-image-list'; target.append(x); return x; })();
  const figure = document.createElement('figure'); figure.className = 'sf-image-item'; const img = document.createElement('img'); img.src = url; img.alt = prompt || 'SceneFrame'; img.loading = 'lazy'; img.title = prompt || ''; figure.append(img); box.append(figure); return { inserted: true, url };
}
