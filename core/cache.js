const DB = 'scene_frame_cache';
const STORE = 'images';
function openDB() { return new Promise((resolve, reject) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function putImage(item) { const db = await openDB(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(item); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
export async function getImage(id) { const db = await openDB(); return new Promise((resolve, reject) => { const r = db.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
