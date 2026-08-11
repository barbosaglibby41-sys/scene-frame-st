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
