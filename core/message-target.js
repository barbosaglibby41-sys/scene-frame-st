function esc(value) { return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
export function findMessageElement(messageId) {
  const id = String(messageId ?? '');
  if (!id) return null;
  const safe = esc(id);
  const selectors = [
    `[mesid="${safe}"]`, `[data-message-id="${safe}"]`, `[data-mesid="${safe}"]`,
    `.mes[mesid="${safe}"]`, `.mes[mesid="${safe}"] .mes_text`,
    `#chat .mes:nth-child(${Number.isInteger(Number(id)) ? Number(id) + 1 : 0})`,
  ];
  return selectors.filter(s => !s.includes('nth-child(0)')).map(s => { try { return document.querySelector(s); } catch { return null; } }).find(Boolean) || null;
}

export function renderGenerateAction({ messageId, item, onGenerate, onDismiss }) {
  const target = findMessageElement(messageId); if (!target) return false;
  const id = String(item.id); let card = target.querySelector(`.sf-inline-action[data-sf-id="${esc(id)}"]`);
  if (!card) { card = document.createElement('div'); card.className = 'sf-inline-action'; card.dataset.sfId = id; target.append(card); }
  const status = item.status || 'pending';
  const label = status === 'generating' ? '正在生成…' : status === 'queued' ? '已加入队列…' : status === 'failed' ? '重新生成图片' : status === 'completed' ? '图片已生成' : '生成图片';
  const disabled = ['generating', 'queued', 'completed'].includes(status);
  card.innerHTML = `<button class="sf-inline-generate ${status === 'generating' || status === 'queued' ? 'sf-loading' : ''}" ${disabled ? 'disabled' : ''}>${status === 'generating' || status === 'queued' ? '<span class="sf-spinner"></span>' : '🖼️'} ${label}</button>${status === 'failed' ? `<span class="sf-inline-error">生成失败</span>` : ''}${status === 'pending' ? '<button class="sf-inline-dismiss" title="忽略">×</button>' : ''}`;
  card.querySelector('.sf-inline-generate')?.addEventListener('click', () => onGenerate?.(item));
  card.querySelector('.sf-inline-dismiss')?.addEventListener('click', () => { card.remove(); onDismiss?.(item); });
  return true;
}

export function insertImageBelowMessage({ messageId, blob, prompt }) {
  const target = findMessageElement(messageId);
  const url = URL.createObjectURL(blob);
  if (!target) return { inserted: false, url };
  const box = target.querySelector?.('.sf-image-list') || (() => { const x = document.createElement('div'); x.className = 'sf-image-list'; target.append(x); return x; })();
  const figure = document.createElement('figure'); figure.className = 'sf-image-item';
  const img = document.createElement('img'); img.src = url; img.alt = prompt || 'SceneFrame'; img.loading = 'lazy'; img.title = prompt || '';
  figure.append(img); box.append(figure);
  return { inserted: true, url };
}
