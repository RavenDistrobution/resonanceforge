// Session autosave: the project is stored in IndexedDB as a project 3MF so a closed tab can be restored.
import { exportProject3MF } from './exporters';
import { project } from './project';

const DB = 'resonanceforge', STORE = 'session';
function openDb(): Promise<IDBDatabase> { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function saveSession(): Promise<void> {
  try { const db = await openDb(); const blob = project.parts.length ? exportProject3MF(project.parts, 'session') : null; const tx = db.transaction(STORE, 'readwrite'); if (blob) tx.objectStore(STORE).put({ blob, when: Date.now(), parts: project.parts.length }, 'last'); else tx.objectStore(STORE).delete('last'); await new Promise((r) => (tx.oncomplete = () => r(null))); db.close(); } catch { /* storage may be unavailable */ }
}
export async function loadSession(): Promise<{ blob: Blob; when: number; parts: number } | null> {
  try { const db = await openDb(); const tx = db.transaction(STORE, 'readonly'); const req = tx.objectStore(STORE).get('last'); const v = await new Promise<any>((res) => { req.onsuccess = () => res(req.result); req.onerror = () => res(null); }); db.close(); return v ?? null; } catch { return null; }
}
let timer = 0;
export function scheduleSessionSave() { clearTimeout(timer); timer = window.setTimeout(() => { void saveSession(); }, 2500); }

// small persisted preferences (theme, printer, nozzle, material)
export function loadPrefs(): Record<string, string> { try { return JSON.parse(localStorage.getItem('rf-prefs') || '{}'); } catch { return {}; } }
export function savePref(key: string, value: string) { try { const p = loadPrefs(); p[key] = value; localStorage.setItem('rf-prefs', JSON.stringify(p)); } catch { /* ignore */ } }
