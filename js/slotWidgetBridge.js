// Native WidgetKit companion integration. Runs only inside the companion WKWebView.
(() => {
    'use strict';
    const handler = window.webkit?.messageHandlers?.slotWidget;
    if (!handler || window !== window.top || !window.slotDb) return;

    let scheduled = false;
    let lastPayload = '';

    async function publishSnapshot() {
        scheduled = false;
        try {
            const visits = await window.slotDb.getAll('visits');
            const activeVisit = visits
                .filter(v => v && v.endedAt == null)
                .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
            const plays = activeVisit ? await window.slotDb.getAll('plays') : [];
            const activePlay = activeVisit ? plays
                .filter(p => p && p.endedAt == null &&
                    String(p.visitId).toLowerCase() === String(activeVisit.id).toLowerCase())
                .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0] : null;

            const snapshot = {
                phase: !activeVisit ? 'idle' : (activePlay ? 'playing' : 'visiting'),
                shopName: activeVisit?.shopName || '',
                machineName: activePlay?.machineName || ''
            };
            const payload = JSON.stringify(snapshot);
            if (payload !== lastPayload) {
                handler.postMessage(snapshot);
                lastPayload = payload;
            }
        } catch (error) {
            // Keep the underlying IndexedDB path independent of widget errors.
            console.warn('Widget snapshot failed', error);
        }
    }

    function scheduleSnapshot() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(publishSnapshot, 150);
    }

    // Update the widget after the EXISTING data layer has successfully committed.
    // Do not change VisitService/PlayService business rules or write to IndexedDB here.
    for (const operation of ['put', 'delete', 'clear', 'transaction']) {
        const original = window.slotDb[operation];
        if (typeof original !== 'function') continue;
        window.slotDb[operation] = async (...args) => {
            const result = await original.apply(window.slotDb, args);
            const relevant = operation === 'transaction'
                ? Array.isArray(args[0]) && args[0].some(c => ['visits', 'plays'].includes(c.store))
                : ['visits', 'plays'].includes(args[0]);
            if (relevant) scheduleSnapshot();
            return result;
        };
    }

    window.addEventListener('pageshow', scheduleSnapshot);
    window.addEventListener('focus', scheduleSnapshot);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleSnapshot();
    });
    scheduleSnapshot();
})();
