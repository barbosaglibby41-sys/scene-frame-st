const KEY = 'scene_frame_message_state';
function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function write(value) { localStorage.setItem(KEY, JSON.stringify(value)); }
export function getRecord(messageId) { return read()[String(messageId)] || null; }
export function rememberBlock(messageId, hash, item) { const all = read(), key = String(messageId ?? 'unknown'); all[key] ||= {}; all[key][hash] = { ...item, savedAt: Date.now() }; write(all); }
export function hasBlock(messageId, hash) { return Boolean(read()[String(messageId ?? 'unknown')]?.[hash]); }
