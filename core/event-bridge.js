const EVENT_NAMES = ['MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED'];

export function getTavernContext() {
  try { return window.SillyTavern?.getContext?.() || window.getContext?.() || null; } catch { return null; }
}

function resolveEvent(name) {
  const tables = [window.event_types, window.tavern_events, window.TAVERN_EVENTS, window.eventSource?.EVENTS];
  for (const table of tables) if (table?.[name]) return table[name];
  return name;
}

function resolveMessage(value) {
  const context = getTavernContext();
  const chat = context?.chat || window.chat || [];
  if (typeof value === 'number' && chat[value]) return { ...chat[value], message_id: value };
  if (typeof value === 'string' && /^\d+$/.test(value) && chat[Number(value)]) return { ...chat[Number(value)], message_id: Number(value) };
  if (Array.isArray(value)) return resolveMessage(value.at(-1));
  if (value && typeof value === 'object') {
    if (typeof value.message_id === 'number' && chat[value.message_id]) return { ...chat[value.message_id], ...value };
    return value;
  }
  return chat.at(-1) || {};
}

export function subscribeToMessages(handler) {
  const unsubs = [], seen = new Set();
  const callback = (...args) => {
    const message = resolveMessage(args.find(x => x !== undefined));
    const key = `${message.message_id ?? message.id ?? 'unknown'}:${String(message.mes || message.message || '').length}`;
    if (seen.has(key)) return;
    seen.add(key); if (seen.size > 300) seen.delete(seen.values().next().value);
    handler(message);
  };
  const eventSource = window.eventSource;
  if (eventSource?.on) {
    for (const name of EVENT_NAMES) { try { const event = resolveEvent(name); eventSource.on(event, callback); unsubs.push(() => eventSource.off?.(event, callback)); } catch (error) { console.debug('[SceneFrame] eventSource skipped', name, error); } }
  }
  const context = getTavernContext();
  const eventOn = window.eventOn || context?.eventOn;
  if (typeof eventOn === 'function') {
    for (const name of EVENT_NAMES) { try { const event = resolveEvent(name), result = eventOn(event, callback); if (typeof result === 'function') unsubs.push(result); } catch (error) { console.debug('[SceneFrame] eventOn skipped', name, error); } }
  }
  let timer;
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => callback(), 180); });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  unsubs.push(() => { clearTimeout(timer); observer.disconnect(); });
  return () => unsubs.forEach(fn => { try { fn(); } catch {} });
}
