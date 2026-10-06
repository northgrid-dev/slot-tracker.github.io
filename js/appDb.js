(() => {
    const DB_NAME = 'slottracker-db';
    // v4 adds appMetadata. Upgrades are add-only; existing user stores are never deleted.
    const DB_VERSION = 4;
    const STORES = ['visits', 'plays', 'recentSelections', 'storedMedalTransactions', 'appLogs', 'appMetadata'];
    const APP_VERSION = '1.7.0';
    let dbPromise;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of STORES) {
                    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    dbPromise = undefined;
                };
                resolve(db);
            };
            request.onerror = () => {
                dbPromise = undefined;
                reject(request.error);
            };
        });
        return dbPromise;
    }

    async function requestResult(name, mode, operation) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(name, mode);
            const store = tx.objectStore(name);
            let request;
            try { request = operation(store); }
            catch (e) { reject(e); return; }
            if (request) {
                request.onsuccess = () => resolve(request.result ?? null);
                request.onerror = () => reject(request.error);
            } else {
                tx.oncomplete = () => resolve();
            }
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    function createUuid() {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }
        const bytes = new Uint8Array(16);
        if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
            globalThis.crypto.getRandomValues(bytes);
        } else {
            for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(b => b.toString(16).padStart(2, '0'));
        return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10,16).join('')}`;
    }

    async function writeJsLog(level, category, message, detail) {
        try {
            const row = {
                id: createUuid(),
                timestamp: new Date().toISOString(),
                level,
                category,
                message,
                detail: detail || null,
                appVersion: APP_VERSION
            };
            await requestResult('appLogs', 'readwrite', store => store.put(row));
        } catch (_) {
            // Never allow logging to cause another failure.
        }
    }

    window.addEventListener('error', event => {
        writeJsLog('Error', 'JavaScript', event.message || 'JavaScript error',
            `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`);
    });

    window.addEventListener('unhandledrejection', event => {
        const reason = event.reason instanceof Error ? `${event.reason.message}\n${event.reason.stack || ''}` : String(event.reason ?? '');
        writeJsLog('Error', 'JavaScriptPromise', '未処理のPromiseエラー', reason);
    });

    async function executeTransaction(changes) {
        if (!Array.isArray(changes) || changes.length === 0) return;

        const db = await openDb();
        const storeNames = [...new Set(changes.map(x => x.store))];

        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeNames, 'readwrite');

            try {
                for (const change of changes) {
                    const store = tx.objectStore(change.store);
                    switch (change.action) {
                        case 'put':
                            store.put(change.value);
                            break;
                        case 'delete':
                            store.delete(change.key);
                            break;
                        case 'clear':
                            store.clear();
                            break;
                        default:
                            throw new Error(`Unknown transaction action: ${change.action}`);
                    }
                }
            } catch (error) {
                try { tx.abort(); } catch (_) { }
                reject(error);
                return;
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
        });
    }

    window.slotDb = {
        getAll: async (name) => (await requestResult(name, 'readonly', store => store.getAll())) || [],
        get: async (name, id) => await requestResult(name, 'readonly', store => store.get(id)),
        put: async (name, value) => await requestResult(name, 'readwrite', store => store.put(value)),
        delete: async (name, id) => await requestResult(name, 'readwrite', store => store.delete(id)),
        clear: async (name) => await requestResult(name, 'readwrite', store => store.clear()),
        transaction: executeTransaction
    };

    window.slotUi = {
        confirm: (message) => window.confirm(message),
        downloadText: (fileName, text, contentType = 'text/plain;charset=utf-8') => {
            const blob = new Blob([text], { type: contentType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };
})();
