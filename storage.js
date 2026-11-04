import { emptyState, validateState } from './model.js';

export const STORAGE_KEY = 'ereswi.todolist.v1';
export const LOCK_KEY = 'ereswi.todolist.write';
export function createStore(storage, locks, onChange, onError) {
  let state = emptyState();
  const read = () => {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? emptyState() : validateState(JSON.parse(raw));
  };
  const refresh = () => {
    try { state = read(); onChange(state); return true; }
    catch (error) { onError(error); return false; }
  };
  const update = async mutator => {
    const work = async () => {
      try {
        const draft = read();
        const result = mutator(draft);
        validateState(draft);
        storage.setItem(STORAGE_KEY, JSON.stringify(draft));
        state = draft;
        onChange(state);
        return { ok: true, result };
      } catch (error) { onError(error); return { ok: false }; }
    };
    try { return locks ? await locks.request(LOCK_KEY, work) : await work(); }
    catch (error) { onError(error); return { ok: false }; }
  };
  return { refresh, update, get state() { return state; } };
}
