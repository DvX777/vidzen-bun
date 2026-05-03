// app/lib/cfPool.js — Shared CF Worker pool (Edge-compatible, stateless)
// Primary workers have a 100k/day free-tier limit.
// Backup workers activate when primaries return 429 or fail consecutively.

// ── Primary pool — read from env so you can add workers without rebuilding ────
// Add more accounts to CF_PRIMARY_WORKERS in .env.local:
//   CF_PRIMARY_WORKERS=cinezo.argentiferous.workers.dev,proxy1.pyroxnoob.workers.dev,...
export const CF_PRIMARY = (
    process.env.CF_PRIMARY_WORKERS ||
    'cinezo.argentiferous.workers.dev,proxy1.pyroxnoob.workers.dev,nameless-band-540c.kaoline.workers.dev,proxy3.rbq56.workers.dev,proxy-4.gx6ewj9nd1.workers.dev,proxy-5.u31dk4n30b.workers.dev,proxy-6.0f62r2a8c2.workers.dev'
).split(',').map(h => h.trim()).filter(Boolean);

// ── Backup pool (from env, comma-separated) ───────────────────────────────────
export const CF_BACKUP = (
    process.env.CF_BACKUP_WORKERS ||
    'backup-proxy.xdbypass.workers.dev,proxy-1.hynercloud.workers.dev'
).split(',').map(h => h.trim()).filter(Boolean);

// ── Full pool — primaries first, backups at the end ───────────────────────────
export const CF_POOL = [...CF_PRIMARY, ...CF_BACKUP];

// ── Round-robin index — persists within a Node.js process ─────────────────────
let _idx = 0;
export function nextWorkerHost() {
    const host = CF_POOL[_idx % CF_POOL.length];
    _idx++;
    return host;
}

// ── Checks ────────────────────────────────────────────────────────────────────
export function isPoolWorker(hostname)    { return CF_POOL.includes(hostname); }
export function isPrimaryWorker(hostname) { return CF_PRIMARY.includes(hostname); }
export function isBackupWorker(hostname)  { return CF_BACKUP.includes(hostname); }

// ── Worker script name (for CF GraphQL API monitoring) ────────────────────────
export function hostToScriptName(host) { return host.split('.')[0]; }

// ── Worker labels for logs ────────────────────────────────────────────────────
export function workerLabel(host) {
    return isBackupWorker(host) ? `[BACKUP] ${host}` : host;
}
