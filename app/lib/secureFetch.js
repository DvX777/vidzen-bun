/* ══════════════════════════════════════════════════
   SECURE FETCH — encrypted API client for the browser.
   Identical to VidMax version.
   ══════════════════════════════════════════════════ */

import { generateECDH, exportPub, importPub, deriveShared, enc, dec } from './crypto';
import { LRUCache } from './lruCache';

let _sp = null;
let _ss = null;

const _cache = new LRUCache(150, 2 * 60_000);

function mapUpstreamError(httpStatus) {
    const status = parseInt(httpStatus);
    if (status === 404) return 'CONTENT_NOT_FOUND';
    if (status === 429) return 'SERVER_BUSY';
    if (status >= 500 && status <= 504) return 'CONTENT_UNAVAILABLE';
    return 'CONTENT_UNAVAILABLE';
}

function mapGatewayHttpError(httpStatus) {
    if (httpStatus === 403) return 'SESSION_EXPIRED';
    if (httpStatus === 503) return 'SERVER_BUSY';
    if (httpStatus === 504) return 'SERVER_TIMEOUT';
    if (httpStatus >= 500) return 'SERVER_ERROR';
    return 'SERVER_ERROR';
}

function isSessionError(errMsg) {
    return errMsg === 'SESSION_EXPIRED' || errMsg === 'HANDSHAKE_FAILED';
}

async function initSession() {
    const kp = await generateECDH();
    const cpk = await exportPub(kp.publicKey);

    let lastErr;
    for (let i = 0; i < 3; i++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10_000);
            const res = await fetch('/api/g/handshake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cpk }),
                signal: controller.signal,
            });
            clearTimeout(timer);

            if (!res.ok) throw new Error('HANDSHAKE_FAILED');
            const { token, spk } = await res.json();

            const serverKey = await importPub(spk);
            const key = await deriveShared(kp.privateKey, serverKey);

            return { key, token };
        } catch (e) {
            lastErr = e;
            if (i < 2) await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
    }
    throw lastErr;
}

function getSession() {
    if (_ss) return Promise.resolve(_ss);
    if (!_sp) {
        _sp = initSession().then(s => { _ss = s; return s; }).catch(e => { _sp = null; throw e; });
    }
    return _sp;
}

function resetSession() { _ss = null; _sp = null; }

if (typeof window !== 'undefined') getSession();

async function doFetch(session, url, externalSignal) {
    const controller = new AbortController();
    // 10s internal timeout — reduced from 20s for faster failover
    const timer = setTimeout(() => controller.abort(), 10_000);
    // Also abort if the caller's signal fires (e.g. megacloud 8s timer)
    const onExtAbort = () => controller.abort();
    if (externalSignal) externalSignal.addEventListener('abort', onExtAbort);

    try {
        const encrypted = await enc({ url, ts: Date.now() }, session.key);

        const res = await fetch('/api/g', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, ...encrypted }),
            signal: controller.signal,
        });

        if (!res.ok) throw new Error(mapGatewayHttpError(res.status));
        const data = await res.json();

        if (data.s && data.s >= 400) {
            try { await dec(data.payload, data.iv, session.key); } catch { }
            throw new Error(mapUpstreamError(data.s));
        }

        const plain = await dec(data.payload, data.iv, session.key);
        try { return JSON.parse(plain); } catch { return plain; }
    } finally {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener('abort', onExtAbort);
    }
}

export async function secureFetch(url, opts = {}) {
    const { signal } = opts;
    const cached = _cache.get(url);
    if (cached) return cached;

    const MAX_SESSION_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_SESSION_RETRIES; attempt++) {
        try {
            const session = await getSession();
            const result = await doFetch(session, url, signal);
            _cache.set(url, result);
            return result;
        } catch (e) {
            // If aborted by caller signal, propagate immediately — don't retry
            if (signal?.aborted || e?.name === 'AbortError') throw e;
            if (!isSessionError(e.message)) throw e;

            resetSession();

            if (attempt < MAX_SESSION_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
            }
        }
    }

    throw new Error('SESSION_RECOVERY_RELOAD');
}
