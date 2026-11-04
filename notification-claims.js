// A unique IndexedDB key is an atomic, durable claim across renderer processes.
// Web Locks alone cannot force another renderer's localStorage cache to refresh.
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('ereswi.todolist.notification-claims', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('claims');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Notification claim database unavailable'));
  });
  return database;
}
export async function claimReminder(key) {
  try {
    const db = await openDatabase();
    return await new Promise(resolve => {
      const transaction = db.transaction('claims', 'readwrite');
      transaction.objectStore('claims').add(true, key);
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => resolve(false);
      transaction.onerror = () => {}; // Duplicate key aborts: another tab already claimed it.
    });
  } catch {
    // Never risk duplicate OS alerts when coordination is unavailable. The saved inbox remains usable.
    return false;
  }
}
