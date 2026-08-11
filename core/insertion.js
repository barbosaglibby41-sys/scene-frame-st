export function insertImageBelowMessage({ messageId, blob, prompt }) {
  const url = URL.createObjectURL(blob);
  const nodes = [...document.querySelectorAll(`[mesid="${CSS.escape(String(messageId))}"], [data-message-id="${CSS.escape(String(messageId))}"]`)];
  const target = nodes[0];
  if (!target) return { inserted: false, url };
  const img = document.createElement('img'); img.src = url; img.alt = prompt || 'SceneFrame'; img.className = 'sf-generated-image'; img.title = prompt || '';
  target.append(img);
  return { inserted: true, url };
}
