const PLUGIN_KEY = 'scene-frame-st';
const LEGACY_KEY = 'scene_frame_settings';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function root() { return globalThis.extension_settings || globalThis.SillyTavern?.getContext?.()?.extensionSettings || null; }
function persistTavern() { const save = globalThis.saveSettingsDebounced || globalThis.saveSettings; try { save?.(); } catch (error) { console.debug('[SceneFrame] setting save fallback', error); } }

export function loadSettings(defaults) {
  const base = clone(defaults); const stRoot = root();
  let legacy = {};
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}') || {}; } catch {}
  if (stRoot) {
    const current = stRoot[PLUGIN_KEY] || {};
    // 首次升级：将旧 localStorage 设置无损迁移进酒馆自身的扩展配置。
    const merged = { ...base, ...legacy, ...current };
    stRoot[PLUGIN_KEY] = merged; persistTavern();
    return merged;
  }
  return { ...base, ...legacy };
}

export function saveSettings(settings) {
  const snapshot = clone(settings); const stRoot = root();
  if (stRoot) { stRoot[PLUGIN_KEY] = snapshot; persistTavern(); }
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(snapshot)); } catch {}
}
