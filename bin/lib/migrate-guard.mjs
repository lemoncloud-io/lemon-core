/**
 * `bin/lib/migrate-guard.mjs` (lemon-core)
 * - the common execution base of the reviewed migration targets (v5 B30, P2-a "migration guard"): on one machine
 *   (one installation) only one guarded write runs at a time, whatever the number of sessions or checkouts.
 * - applies only to the reviewed registry `ORG_DEFAULTS.migration.targets`. Any other deploy target is
 *   `not-applicable`: the guard reads or opens nothing for it (no install file, no root, no port, no journal) — N14.
 * - order of a guarded write: target classification → installation → host lock → journal → write.
 * - a cooperative procedural control between the tools of one installation; it is not a security boundary.
 * - library only in B30; v5 B31 connects the writers (`lemon-lambda-deploy`, `lemon-lambda-deploy-dev`,
 *   `lemon-lambda-migrate` six phases) through `runGuarded` / `planGuard` (§ G) and adds the `lemon-lambda-guard` CLI.
 *   No AWS call; no network but a loopback listen.
 * - messages carry a code and a short sentence: no account, no root path, no value.
 * - see `docs/v5/B30-migration-guard.md`.
 */
//* v5 B30: new module (classification, installation, host lock, registry, journal, guarded write).
import * as nodeFs from 'node:fs/promises';
import * as nodeNet from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ORG_DEFAULTS } from './org-defaults.mjs';
import { MigrationError } from './migrate-core.mjs';
import { redact, stripControl, isSensitiveKey, SENSITIVE_KEY_PARTS } from './common.mjs';

// the doc that error texts point to.
export const DOC_REF = 'docs/v5/B30-migration-guard.md';

// the env key of the install file path (an absolute path; else the default path below).
export const INSTALL_ENV = 'LEMON_MIGRATION_GUARD_INSTALL';

//* v5 B30 r2: the default install file path, relative to the home dir (`~/.lemon-core/migration-guard.install.json`).
export const DEFAULT_INSTALL = Object.freeze(['.lemon-core', 'migration-guard.install.json']);

// the env key that, when set, must equal the root of the install file.
export const STATE_DIR_ENV = 'MIGRATION_STATE_DIR';

// the entries of a guard root.
export const ROOT_FILES = Object.freeze({ install: 'install.json', registry: 'registry.json', journal: 'journal' });

// the states of one journal file.
export const JOURNAL_STATES = Object.freeze(['inflight', 'completed', 'unknown']);

// the reasons of a `blocked` result (install codes lower-cased, then lock / journal / registry).
export const BLOCKED_REASONS = Object.freeze([
    'install-invalid',
    'root-invalid',
    'root-missing',
    'root-mismatch',
    'root-unsupported-volume',
    'busy',
    'journal-unresolved',
    'registry-invalid',
    'not-registered',
    'identity-mismatch',
    'run-unresolved',
]);

//* v5 B30 r2: the run-state enums of a registry entry (B27 classes / run states plus `none` for no run state).
export const RUN_STATES = Object.freeze(['completed', 'resolved-observed-diff', 'unresolved', 'none']);
// the `reconcile` class of the last check of the target (B27 `CLASSES`).
export const CLASSES = Object.freeze(['verified-no-op', 'reconcile-required', 'blocked']);
// the baseline the class was computed against.
export const BASELINE_KINDS = Object.freeze(['run-receipt', 'first-observation', 'reviewed-rebaseline']);

// path segments of the usual file-sync apps (best effort: a path check cannot see every sync app).
const SYNC_SEGMENTS = Object.freeze([
    'Dropbox',
    'iCloud',
    'Mobile Documents',
    'Google Drive',
    'GoogleDrive',
    'OneDrive',
    'Box',
    'Nextcloud',
    'Sync',
    'CloudStorage',
]);

// mount prefixes of removable / network volumes.
const NETWORK_PREFIXES = Object.freeze(['/Volumes/', '/mnt/', '/net/']);

// the install failures that a guarded write reports as `blocked` (not thrown).
const INSTALL_FAILURES = new Set([
    'INSTALL_INVALID',
    'ROOT_INVALID',
    'ROOT_MISSING',
    'ROOT_MISMATCH',
    'ROOT_UNSUPPORTED_VOLUME',
]);

// the longest free text kept (holder, decision ref, error message, confirmation).
const TEXT_MAX = 200;
// the most request ids kept per operation.
const MAX_REQUEST_IDS = 100;

// value rules.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const ACCOUNT_RE = /^\d{12}$/;
const REGION_RE = /^[a-z]{2}-[a-z]+-\d$/;
const MACHINE_RE = /^[A-Za-z0-9._-]{1,64}$/;
// a decision reference: URL / id characters only, no blank, stored byte for byte.
const DECISION_REF_RE = /^[A-Za-z0-9._:/#@?=&%+~-]+$/;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
// a journal file name (`<UTC stamp>-<operation id>.json`) and a temp file of an atomic write.
const JOURNAL_NAME_RE = /^(\d{8}T\d{9}Z)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const TMP_NAME_RE = /^\.[^/]+\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// the plain-object test.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
// throw a known error (message without values).
const fail = (code, message) => {
    throw new MigrationError(code, message);
};
// sha256 hex (same rule as `migrate-core.mjs`).
const hash = x => createHash('sha256').update(x).digest('hex');
// canonical JSON (same rule as `migrate-core.mjs`).
const canonical = x => JSON.stringify(x);
// true when `o` is an object with every required key and no key outside required + optional.
const exactKeys = (o, required, optional = []) =>
    object(o) &&
    required.every(k => Object.hasOwn(o, k)) &&
    Object.keys(o).every(k => required.includes(k) || optional.includes(k));
// an ISO 8601 time string.
const isIso = v => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
// a free text of 1..200 characters that is not blank.
const isText = v => typeof v === 'string' && v.length >= 1 && v.length <= TEXT_MAX && v.trim().length > 0;
// a lock port: an integer in 1024..65535 (0 = automatic port is refused).
const isPort = v => Number.isInteger(v) && v >= 1024 && v <= 65535;
// the file-name stamp of a time (`20261101T120000123Z`, ISO 8601 basic format).
const stampOf = date => date.toISOString().replace(/[-:.]/g, '');
// install failure code → blocked reason (`ROOT_MISSING` → `root-missing`).
const reasonOf = code => code.toLowerCase().replaceAll('_', '-');
// the registry key of a target installation (`<account>/<region>/<stage>/<project>`).
const keyOf = (account, region, stage, project) => `${account}/${region}/${stage}/${project}`;
// the injectable effects (tests pass spies); defaults are the node modules and the reviewed registry.
const io = deps => ({
    fs: deps?.fs ?? nodeFs,
    net: deps?.net ?? nodeNet,
    now: deps?.now ?? (() => new Date()),
    homedir: deps?.homedir ?? os.homedir,
    targets: deps?.targets ?? ORG_DEFAULTS.migration.targets,
});

/**
 * a free text as the guard stores or returns it: control characters dropped, `redact()` of `common.mjs` (accounts,
 * ARNs, access keys, keyed secrets, tokens, URLs), every word holding a secret-like fragment hidden, 200 characters.
 */
export const scrub = (text, max = TEXT_MAX) => {
    // v5 B30 r2: URL-encoded ARNs and dashed account ids first, then `redact()`.
    const pre = stripControl(`${text}`)
        .replace(/arn%3Aaws[^\s]*/gi, '<arn>')
        // r3: hex boundaries so a uuid or a 40-hex sha is not cut (review note a).
        .replace(/(?<![0-9A-Fa-f-])\d{4}-\d{4}-\d{4}(?![0-9A-Fa-f-])/g, '<acct>');
    const s = redact(pre).replace(/[A-Za-z0-9_.-]+/g, w => (isSensitiveKey(w) ? '<redacted>' : w));
    return [...s].slice(0, max).join('');
};

/** the run-state reference of a private absolute path: its sha256 hex (the path itself is never stored). */
export const runStateRefOf = privatePath => {
    // v5 B30 r2: an absolute path only (a relative one would depend on the cwd).
    if (typeof privatePath !== 'string' || !path.isAbsolute(privatePath))
        fail('INVALID_INPUT', 'A run-state reference needs an absolute path.');
    return hash(path.normalize(privatePath));
};

//* ---- A. target classification ----

/** the reviewed registry, checked on every call: frozen array, string identity + revision, unique project+stage. */
export function validateTargets(targets) {
    // a damaged list is refused (fail-closed), never read as "outside the registry".
    const bad = () => fail('REGISTRY_INVALID', 'The reviewed migration target registry is invalid.');
    if (!Array.isArray(targets) || !Object.isFrozen(targets)) bad();
    const seen = new Set();
    // each entry: string identity and revision, no project+stage twice.
    for (const t of targets) {
        if (!object(t) || !['project', 'stage', 'stack', 'revision'].every(k => typeof t[k] === 'string' && t[k]))
            bad();
        const key = canonical([t.project, t.stage]);
        if (seen.has(key)) bad();
        seen.add(key);
    }
    return targets;
}

/**
 * classify a target `{ project, stage, stack? }` (exact string match, no trim or case folding):
 * - outside the registry → `{ applicability: 'not-applicable', reason: 'outside-registry' }` (no I/O at all);
 * - one entry → `{ applicability: 'applicable', target, identity }`; a given `stack` must equal the entry's
 *   (else `TARGET_MISMATCH`), a missing one takes the entry's.
 */
export function classifyTarget(input, deps = {}) {
    // input shape first (extra keys of a config are ignored).
    if (
        !object(input) ||
        typeof input.project !== 'string' ||
        typeof input.stage !== 'string' ||
        (input.stack !== undefined && typeof input.stack !== 'string')
    )
        fail('INVALID_INPUT', 'A target needs project and stage strings (stack optional).');
    const targets = validateTargets(io(deps).targets);
    const found = targets.filter(t => t.project === input.project && t.stage === input.stage);
    // no candidate: a general deploy target, untouched by the guard.
    if (found.length === 0) return Object.freeze({ applicability: 'not-applicable', reason: 'outside-registry' });
    // defence in depth: the registry check above already refuses duplicates.
    if (found.length > 1) fail('REGISTRY_INVALID', 'The reviewed migration target registry is invalid.');
    const [target] = found;
    if (input.stack !== undefined && input.stack !== target.stack)
        fail('TARGET_MISMATCH', 'The stack does not match the reviewed migration target.');
    const identity = Object.freeze({ project: target.project, stage: target.stage, stack: target.stack });
    return Object.freeze({ applicability: 'applicable', target, identity });
}

//* ---- B. installation ----

/**
 * true when a root path looks like a file-sync folder or a removable / network mount. Best effort only: a path
 * check cannot detect every sync app or a synced parent, so the install file must also record who confirmed the
 * root is on a local, non-synced volume (`localVolume.confirmedBy`).
 */
export function unsupportedVolume(root) {
    if (NETWORK_PREFIXES.some(p => `${root}`.startsWith(p))) return true;
    // a segment equal to a sync name, or the name followed by a non-alphanumeric suffix (`Dropbox (Personal)`);
    //  v5 B30 r2: case-insensitive.
    const names = SYNC_SEGMENTS.map(n => n.toLowerCase());
    return `${root}`
        .split('/')
        .map(seg => seg.toLowerCase())
        .some(seg =>
            names.some(name => seg === name || (seg.startsWith(name) && /^[^a-z0-9]/.test(seg.slice(name.length)))),
        );
}

// the pure root path rules: absolute, normalized, not the file-system root.
function checkRootPath(root) {
    if (
        typeof root !== 'string' ||
        !path.isAbsolute(root) ||
        path.normalize(root) !== root ||
        root.endsWith(path.sep) ||
        path.parse(root).root === root
    )
        fail('ROOT_INVALID', 'The guard root must be an absolute, normalized path.');
    if (unsupportedVolume(root))
        fail('ROOT_UNSUPPORTED_VOLUME', 'The guard root must be on a local volume that is not synced or mounted.');
}

/**
 * the install file path: `LEMON_MIGRATION_GUARD_INSTALL` (absolute only), else the default fixed path under the home
 * dir. There is no argument: the root and port come from this one file, whose place the operator decides.
 */
export function installPath({ env = process.env, deps } = {}) {
    const fromEnv = env?.[INSTALL_ENV];
    // a set env must be an absolute path (a relative one would depend on the cwd).
    if (fromEnv !== undefined) {
        if (typeof fromEnv !== 'string' || !path.isAbsolute(fromEnv))
            fail('INSTALL_INVALID', `${INSTALL_ENV} must be an absolute path.`);
        return fromEnv;
    }
    const home = io(deps).homedir();
    if (typeof home !== 'string' || !path.isAbsolute(home))
        fail('INSTALL_INVALID', 'No home directory for the default guard install file.');
    return path.join(home, ...DEFAULT_INSTALL);
}

/**
 * read and check the install file (outside the root; `installPath`), without touching the root.
 * Schema `{ schemaVersion: 1, root, port, machineId, localVolume: { confirmedBy, at } }`.
 */
export async function readInstallConfig({ env = process.env, deps } = {}) {
    const { fs } = io(deps);
    const file = installPath({ env, deps });
    let raw;
    // read + parse (a missing or unreadable file is an invalid installation).
    try {
        raw = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        fail('INSTALL_INVALID', 'The guard install file is missing or not valid JSON.');
    }
    // exact schema: no other key, no other type.
    if (
        !exactKeys(raw, ['schemaVersion', 'root', 'port', 'machineId', 'localVolume']) ||
        raw.schemaVersion !== 1 ||
        typeof raw.root !== 'string' ||
        !isPort(raw.port) ||
        typeof raw.machineId !== 'string' ||
        !MACHINE_RE.test(raw.machineId) ||
        !exactKeys(raw.localVolume, ['confirmedBy', 'at']) ||
        !isText(raw.localVolume.confirmedBy) ||
        !isIso(raw.localVolume.at)
    )
        fail('INSTALL_INVALID', 'Invalid guard install file.');
    checkRootPath(raw.root);
    // the install file lives outside the root (a copied root never carries its own installation).
    const abs = path.resolve(file);
    if (abs === raw.root || abs.startsWith(raw.root + path.sep))
        fail('INSTALL_INVALID', 'The guard install file must live outside the guard root.');
    // the install file is the only source of the root; a differing state-dir env is refused.
    if (env?.[STATE_DIR_ENV] !== undefined && env[STATE_DIR_ENV] !== raw.root)
        fail('ROOT_MISMATCH', `${STATE_DIR_ENV} differs from the guard root of the install file.`);
    return Object.freeze({
        root: raw.root,
        port: raw.port,
        machineId: raw.machineId,
        localVolume: Object.freeze({ confirmedBy: raw.localVolume.confirmedBy, at: raw.localVolume.at }),
    });
}

// the root `install.json` (null when absent); unreadable or not a regular file → ROOT_MISMATCH.
async function readRootInstall(fs, root) {
    const file = path.join(root, ROOT_FILES.install);
    const st = await fs.lstat(file).catch(() => null);
    if (!st) return null;
    const mismatch = () => fail('ROOT_MISMATCH', 'The guard root does not belong to this installation.');
    if (!st.isFile()) mismatch();
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        mismatch();
    }
}

// true when the root `install.json` names the same installation (all four fields equal).
const sameInstall = (marker, config) =>
    exactKeys(marker, ['schemaVersion', 'root', 'port', 'machineId'], ['initializedAt']) &&
    marker.schemaVersion === 1 &&
    marker.root === config.root &&
    marker.port === config.port &&
    marker.machineId === config.machineId &&
    (marker.initializedAt === undefined || isIso(marker.initializedAt));

/**
 * the installation of this machine: the install file plus its root, which must be its own real path (no symlink,
 * `ROOT_INVALID`), an existing directory with an `install.json` (`ROOT_MISSING`) whose schemaVersion, root, port and
 * machineId all equal the install file (`ROOT_MISMATCH`). Returns `{ root, port, machineId, localVolume }` (frozen).
 */
export async function loadInstall({ env = process.env, deps } = {}) {
    const config = await readInstallConfig({ env, deps });
    const { fs } = io(deps);
    const st = await fs.lstat(config.root).catch(() => null);
    if (!st) fail('ROOT_MISSING', 'The guard root does not exist.');
    if (st.isSymbolicLink()) fail('ROOT_INVALID', 'The guard root must not be a symlink.');
    // a symlink anywhere in the path changes the real path.
    const real = await fs.realpath(config.root).catch(() => null);
    if (real !== config.root) fail('ROOT_INVALID', 'The guard root must be its own real path.');
    if (!st.isDirectory()) fail('ROOT_MISSING', 'The guard root is not a directory.');
    const marker = await readRootInstall(fs, config.root);
    if (!marker) fail('ROOT_MISSING', 'The guard root has no install.json.');
    if (!sameInstall(marker, config)) fail('ROOT_MISMATCH', 'The guard root does not belong to this installation.');
    return config;
}

// the root / port / machineId of an installation object (from `loadInstall` or `readInstallConfig`).
function installOf(install) {
    if (
        !object(install) ||
        typeof install.root !== 'string' ||
        !isPort(install.port) ||
        !MACHINE_RE.test(`${install.machineId}`)
    )
        fail('INSTALL_INVALID', 'Invalid guard installation.');
    return install;
}

// fsync a directory after a rename (some file systems refuse a directory fsync; then the rename stands alone).
async function syncDir(fs, dir) {
    let handle;
    // v5 B30 r2: an open failure is a known error (no raw fs message, no path).
    try {
        handle = await fs.open(dir, 'r');
    } catch {
        fail('STATE_WRITE_FAILED', 'Could not write the guard state.');
    }
    try {
        await handle.sync();
    } catch {
        // best effort: the data file itself was fsynced before the rename.
    } finally {
        await handle.close();
    }
}

// write a JSON file atomically: temp file (0600, `wx`) → fsync → rename → directory fsync.
async function writeAtomic(fs, file, value) {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${randomUUID()}`);
    let handle;
    try {
        handle = await fs.open(tmp, 'wx', 0o600);
    } catch {
        fail('STATE_WRITE_FAILED', 'Could not write the guard state.');
    }
    // the temp file is removed again when any step before the rename fails.
    try {
        await handle.chmod(0o600);
        await handle.writeFile(canonical(value) + '\n');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(tmp, file);
    } catch {
        await handle?.close().catch(() => {});
        await fs.unlink(tmp).catch(() => {});
        fail('STATE_WRITE_FAILED', 'Could not write the guard state.');
    }
    await syncDir(fs, path.dirname(file));
}

/**
 * set up a new guard root once, at installation: the root (0700; its parent must exist and be its own real path),
 * an empty `journal/` (0700), an empty `registry.json` and last the `install.json` with `initializedAt` (0600).
 * An existing root is refused (`ROOT_EXISTS`): a root is never initialized twice nor repaired automatically.
 */
export async function initializeRoot(install, deps = {}) {
    const { root, port, machineId } = installOf(install);
    checkRootPath(root);
    const { fs, now } = io(deps);
    const parent = path.dirname(root);
    if ((await fs.realpath(parent).catch(() => null)) !== parent)
        fail('ROOT_INVALID', 'The parent of the guard root must exist and be its own real path.');
    // `mkdir` without `recursive` is the exclusive step: an existing root stops here.
    let created = false;
    try {
        await fs.mkdir(root, { mode: 0o700 });
        created = true;
    } catch (e) {
        if (e?.code !== 'EEXIST') fail('ROOT_INVALID', 'Could not create the guard root.');
    }
    if (!created) fail('ROOT_EXISTS', 'The guard root exists already; it is never initialized twice.');
    const journal = path.join(root, ROOT_FILES.journal);
    // v5 B30 r2: modes and the journal dir; a raw fs error becomes STATE_WRITE_FAILED (no path in the message).
    try {
        await fs.chmod(root, 0o700);
        await fs.mkdir(journal, { mode: 0o700 });
        await fs.chmod(journal, 0o700);
    } catch {
        fail('STATE_WRITE_FAILED', 'Could not write the guard state.');
    }
    await writeAtomic(fs, path.join(root, ROOT_FILES.registry), { schemaVersion: 1, machineId, entries: {} });
    const initializedAt = now().toISOString();
    // the marker is written last: a half-made root has no install.json and stays refused.
    await writeAtomic(fs, path.join(root, ROOT_FILES.install), {
        schemaVersion: 1,
        root,
        port,
        machineId,
        initializedAt,
    });
    return Object.freeze({ initializedAt });
}

//* ---- C. host lock ----

// the holder text of a lock or journal record (1..200 characters, stored scrubbed).
function holderOf(holder) {
    if (!isText(holder)) fail('INVALID_INPUT', 'A holder (1..200 characters, not blank) is required.');
    return scrub(holder);
}

/**
 * the host lock of an installation: an exclusive loopback listen on the install port (`127.0.0.1`). Taken only after
 * `listening`; a port in use is `LOCK_BUSY` (no other port is tried, no other process is touched). Incoming
 * connections are closed at once. The OS frees the lock when the process ends (that is "lock released"; whether the
 * work completed is the journal's answer). Returns `{ port, holder, acquiredAt, release() }`.
 */
export async function acquireHostLock({ port, holder, deps } = {}) {
    if (!isPort(port)) fail('INVALID_INPUT', 'The lock port must be an integer in 1024..65535.');
    const who = holderOf(holder);
    const { net, now } = io(deps);
    // no data and no command: every connection is dropped.
    const server = net.createServer(socket => socket.destroy());
    try {
        await new Promise((resolve, reject) => {
            // whichever comes first: `listening` (taken) or `error` (not taken).
            const onError = e => {
                server.off('listening', onListening);
                reject(e);
            };
            const onListening = () => {
                server.off('error', onError);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen({ host: '127.0.0.1', port, exclusive: true, reusePort: false });
        });
    } catch (e) {
        server.close(() => {});
        if (e?.code === 'EADDRINUSE' || e?.code === 'EACCES')
            fail('LOCK_BUSY', 'Another guarded write holds the host lock of this installation.');
        fail('LOCK_FAILED', 'Could not take the host lock.');
    }
    // a later server error must not crash the process holding the lock.
    server.on('error', () => {});
    let closing = null;
    // close once, wait for it; a second call returns the same promise.
    const release = () => (closing ??= new Promise(resolve => server.close(() => resolve())));
    return Object.freeze({ port, holder: who, acquiredAt: now().toISOString(), release });
}

//* ---- D. registry ----

// v5 B30 r2: the three run-state fields of an entry are in their enums.
const runStateOk = e =>
    CLASSES.includes(e?.class) && RUN_STATES.includes(e?.runState) && BASELINE_KINDS.includes(e?.baselineKind);

// one registry entry (history items have no history of their own); the key must name its account/region/target.
function validEntry(key, e, nested = false) {
    const keys = ['identity', 'account', 'region', 'runStateRef', 'class', 'runState', 'baselineKind', 'registeredAt'];
    if (!exactKeys(e, keys, nested ? [] : ['history'])) return false;
    const id = e.identity;
    return (
        exactKeys(id, ['project', 'stage', 'stack']) &&
        ['project', 'stage', 'stack'].every(k => typeof id[k] === 'string' && id[k]) &&
        ACCOUNT_RE.test(`${e.account}`) &&
        typeof e.account === 'string' &&
        typeof e.region === 'string' &&
        REGION_RE.test(e.region) &&
        typeof e.runStateRef === 'string' &&
        SHA_RE.test(e.runStateRef) &&
        runStateOk(e) &&
        isIso(e.registeredAt) &&
        key === keyOf(e.account, e.region, id.stage, id.project) &&
        (e.history === undefined || (Array.isArray(e.history) && e.history.every(h => validEntry(key, h, true))))
    );
}

/** the registry of the root (`registry.json`, regular file, this machineId, every entry valid). */
export async function readRegistry(install, deps = {}) {
    const { root, machineId } = installOf(install);
    const { fs } = io(deps);
    const file = path.join(root, ROOT_FILES.registry);
    const bad = () => fail('REGISTRY_STATE_INVALID', 'The guard registry is missing or invalid.');
    const st = await fs.lstat(file).catch(() => null);
    if (!st?.isFile()) bad();
    let raw;
    try {
        raw = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        bad();
    }
    if (
        !exactKeys(raw, ['schemaVersion', 'machineId', 'entries']) ||
        raw.schemaVersion !== 1 ||
        raw.machineId !== machineId ||
        !object(raw.entries) ||
        !Object.entries(raw.entries).every(([key, e]) => validEntry(key, e))
    )
        bad();
    return raw;
}

/**
 * register (or update) a reviewed target of this installation under `<account>/<region>/<stage>/<project>`; an
 * overwritten entry is kept in `history[]`. `account` / `region` are the expected values of the private config
 * (never a profile name); `runStateRef` is a sha256 digest (`runStateRefOf`), never a path. Registration is neither
 * a write approval nor a migration success. Taken under the host lock; atomic write, 0600. Allowed while the journal
 * is unresolved (a control record, not a write of the target).
 */
export async function registerTarget(install, entry, deps = {}) {
    const inst = installOf(install);
    const { fs, now } = io(deps);
    // entry shape and values (no free text: everything is a token, a digest or an identity).
    if (
        !exactKeys(entry, ['identity', 'account', 'region', 'runStateRef', 'class', 'runState', 'baselineKind']) ||
        !exactKeys(entry.identity, ['project', 'stage', 'stack']) ||
        typeof entry.account !== 'string' ||
        !ACCOUNT_RE.test(entry.account) ||
        typeof entry.region !== 'string' ||
        !REGION_RE.test(entry.region) ||
        typeof entry.runStateRef !== 'string' ||
        !SHA_RE.test(entry.runStateRef) ||
        !runStateOk(entry)
    )
        fail('INVALID_INPUT', 'Invalid registry entry.');
    const classified = classifyTarget(entry.identity, deps);
    if (classified.applicability !== 'applicable')
        fail('TARGET_MISMATCH', 'Only reviewed migration targets are registered.');
    const lock = await acquireHostLock({ port: inst.port, holder: 'register-target', deps });
    try {
        const registry = await readRegistry(inst, deps);
        const { project, stage } = classified.identity;
        const key = keyOf(entry.account, entry.region, stage, project);
        const prev = registry.entries[key];
        const registeredAt = now().toISOString();
        const next = {
            identity: { ...classified.identity },
            account: entry.account,
            region: entry.region,
            runStateRef: entry.runStateRef,
            class: entry.class,
            runState: entry.runState,
            baselineKind: entry.baselineKind,
            registeredAt,
        };
        // the previous value moves to history (append-only).
        if (prev) {
            const { history = [], ...old } = prev;
            next.history = [...history, old];
        }
        const file = path.join(inst.root, ROOT_FILES.registry);
        await writeAtomic(fs, file, { ...registry, entries: { ...registry.entries, [key]: next } });
        return Object.freeze({ replaced: Boolean(prev), registeredAt });
    } finally {
        await lock.release();
    }
}

//* ---- E. journal ----

//* v5 B30 r2: a decision `{ ref, digest }`: `ref` stored byte for byte, so it may not look like a secret.
const decisionRefOk = ref =>
    typeof ref === 'string' &&
    ref.length >= 1 &&
    ref.length <= TEXT_MAX &&
    DECISION_REF_RE.test(ref) &&
    // r3: 12 digits only outside a hex run, so a pinned 40-hex commit sha in the ref is not refused by chance.
    !/(?<![0-9A-Fa-f])\d{12}(?![0-9A-Fa-f])/.test(ref) &&
    !/(?<![0-9A-Fa-f-])\d{4}-\d{4}-\d{4}(?![0-9A-Fa-f-])/.test(ref) &&
    !/(?:AKIA|ASIA)[0-9A-Z]{16}/.test(ref) &&
    !/arn(?::|%3a)aws/i.test(ref) &&
    !SENSITIVE_KEY_PARTS.some(p => ref.toLowerCase().includes(p));
// the decision object: exact keys, a valid ref and the sha256 hex of the decision text the caller keeps.
const decisionOk = d =>
    exactKeys(d, ['ref', 'digest']) && decisionRefOk(d.ref) && typeof d.digest === 'string' && SHA_RE.test(d.digest);

// one journal record (schema check; the file name must carry its operation id).
function validJournal(name, rec) {
    const m = JOURNAL_NAME_RE.exec(name);
    const required = ['schemaVersion', 'operationId', 'identity', 'holder', 'startedAt', 'state', 'requestIds'];
    const optional = ['before', 'after', 'receiptDigest', 'endedAt', 'error', 'resolution'];
    const digest = v => v === undefined || (typeof v === 'string' && SHA_RE.test(v));
    return (
        Boolean(m) &&
        exactKeys(rec, required, optional) &&
        rec.schemaVersion === 1 &&
        typeof rec.operationId === 'string' &&
        UUID_RE.test(rec.operationId) &&
        rec.operationId === m[2] &&
        exactKeys(rec.identity, ['project', 'stage', 'stack']) &&
        ['project', 'stage', 'stack'].every(k => typeof rec.identity[k] === 'string') &&
        typeof rec.holder === 'string' &&
        isIso(rec.startedAt) &&
        JOURNAL_STATES.includes(rec.state) &&
        Array.isArray(rec.requestIds) &&
        rec.requestIds.every(id => typeof id === 'string') &&
        digest(rec.before) &&
        digest(rec.after) &&
        digest(rec.receiptDigest) &&
        (rec.endedAt === undefined || isIso(rec.endedAt)) &&
        (rec.error === undefined ||
            (exactKeys(rec.error, ['code', 'message']) &&
                typeof rec.error.code === 'string' &&
                typeof rec.error.message === 'string')) &&
        (rec.resolution === undefined ||
            (exactKeys(rec.resolution, ['decision', 'at']) &&
                decisionOk(rec.resolution.decision) &&
                isIso(rec.resolution.at)))
    );
}

// read one journal entry: the record, or null when it is not a valid regular journal file.
async function readJournalFile(fs, dir, name) {
    const file = path.join(dir, name);
    const st = await fs.lstat(file).catch(() => null);
    if (!st?.isFile()) return null;
    try {
        const rec = JSON.parse(await fs.readFile(file, 'utf8'));
        return validJournal(name, rec) ? rec : null;
    } catch {
        return null;
    }
}

/**
 * the journal state of the root: `'idle' | 'inflight' | 'unknown'`.
 * - a damaged entry (not parseable, other schema, not a regular file) → `'unknown'` (damage is unresolved too);
 * - else the newest `inflight` / `unknown` file without a `resolution` gives the state; `completed` and resolved
 *   files count as idle; no file → `'idle'`;
 * - no `journal/` (or not a plain directory) → `'unknown'`: a normal initial state cannot be shown, and the journal is
 *   never created here (`initializeRoot` makes it at installation).
 */
export async function operationState(install, deps = {}) {
    const { root } = installOf(install);
    const { fs } = io(deps);
    const dir = path.join(root, ROOT_FILES.journal);
    const st = await fs.lstat(dir).catch(() => null);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return 'unknown';
    const names = await fs.readdir(dir).catch(() => null);
    if (!names) return 'unknown';
    let damaged = false;
    let latest = null;
    // names sort by their UTC stamp, so the last unresolved file is the newest.
    for (const name of [...names].sort()) {
        // a temp file of an interrupted atomic write is never a record (its target file keeps its own state).
        if (TMP_NAME_RE.test(name)) continue;
        const rec = await readJournalFile(fs, dir, name);
        if (!rec) {
            damaged = true;
            continue;
        }
        if (rec.resolution || rec.state === 'completed') continue;
        latest = rec.state;
    }
    if (damaged) return 'unknown';
    return latest ?? 'idle';
}

/**
 * record an owner decision on an `inflight` / `unknown` operation: adds `resolution: { decision: { ref, digest }, at }`
 * to its file (every original field kept as is). `ref` (1..200 of `[A-Za-z0-9._:/#@?=&%+~-]`, e.g. a review comment
 * URL) points to the decision and is stored byte for byte, so a ref with a 12-digit number, an ARN or a secret-like
 * word is refused, not scrubbed; `digest` is the sha256 hex of the decision text the caller keeps. A reason text
 * alone does not resolve. Only files with a `resolution` count as idle. This records a cooperative procedure; it is
 * not a security boundary and proves nothing about the target. Taken under the host lock.
 */
export async function resolveOperation(install, operationId, { decision, deps } = {}) {
    const inst = installOf(install);
    if (typeof operationId !== 'string' || !UUID_RE.test(operationId)) fail('INVALID_INPUT', 'Invalid operation id.');
    if (!decisionOk(decision))
        fail(
            'INVALID_INPUT',
            'A decision { ref, digest } is required: ref of 1..200 reference characters without an account, ARN or secret word, digest sha256 hex.',
        );
    const { fs, now } = io(deps);
    const lock = await acquireHostLock({ port: inst.port, holder: 'resolve-operation', deps });
    try {
        const dir = path.join(inst.root, ROOT_FILES.journal);
        const names = ((await fs.readdir(dir).catch(() => [])) ?? []).filter(
            n => JOURNAL_NAME_RE.exec(n)?.[2] === operationId,
        );
        if (names.length !== 1) fail('OPERATION_NOT_FOUND', 'No journal file of this operation.');
        const rec = await readJournalFile(fs, dir, names[0]);
        if (!rec) fail('JOURNAL_INVALID', 'The journal file is damaged; it needs a manual review.');
        if (rec.state === 'completed')
            fail('OPERATION_NOT_UNRESOLVED', 'Only an inflight or unknown operation is resolved.');
        if (rec.resolution) fail('OPERATION_RESOLVED', 'The operation is resolved already.');
        const resolution = { decision: { ref: decision.ref, digest: decision.digest }, at: now().toISOString() };
        await writeAtomic(fs, path.join(dir, names[0]), { ...rec, resolution });
        return Object.freeze({ operationId, state: rec.state, resolution: Object.freeze({ ...resolution }) });
    } finally {
        await lock.release();
    }
}

//* ---- F. guarded write ----

// the expected account (12 digits) and region of the private config.
function expectedOf(expected) {
    if (
        !exactKeys(expected, ['account', 'region']) ||
        typeof expected.account !== 'string' ||
        !ACCOUNT_RE.test(expected.account) ||
        typeof expected.region !== 'string' ||
        !REGION_RE.test(expected.region)
    )
        fail('INVALID_INPUT', 'An expected account (12 digits) and region are required.');
    return { account: expected.account, region: expected.region };
}

// the success result of an adapter write (`{ requestIds?, receiptDigest?, before?, after? }`), or null.
function resultOf(result) {
    if (result === undefined) return { requestIds: [] };
    if (!exactKeys(result, [], ['requestIds', 'receiptDigest', 'before', 'after'])) return null;
    const ids = result.requestIds ?? [];
    if (
        !Array.isArray(ids) ||
        ids.length > MAX_REQUEST_IDS ||
        !ids.every(id => typeof id === 'string' && REQUEST_ID_RE.test(id))
    )
        return null;
    const digests = {};
    // each digest is a sha256 hex or absent.
    for (const k of ['before', 'after', 'receiptDigest']) {
        if (result[k] === undefined) continue;
        if (typeof result[k] !== 'string' || !SHA_RE.test(result[k])) return null;
        digests[k] = result[k];
    }
    return { requestIds: [...ids], ...digests };
}

// the stored code of an adapter error (scrubbed; a secret-like or odd code becomes `ADAPTER_ERROR`).
function errorCodeOf(e) {
    const code = typeof e?.code === 'string' ? scrub(e.code, 64) : '';
    return CODE_RE.test(code) ? code : 'ADAPTER_ERROR';
}

// the installation, or the blocked reason of an install failure.
async function installOrReason({ env, deps }) {
    try {
        return { inst: await loadInstall({ env, deps }) };
    } catch (e) {
        if (INSTALL_FAILURES.has(e?.code)) return { reason: reasonOf(e.code) };
        throw e;
    }
}

// journal and registry checks of an applicable target: a blocked reason, or null when ready.
async function preflight(inst, identity, want, deps) {
    if ((await operationState(inst, deps)) !== 'idle') return 'journal-unresolved';
    let registry;
    try {
        registry = await readRegistry(inst, deps);
    } catch (e) {
        if (e?.code === 'REGISTRY_STATE_INVALID') return 'registry-invalid';
        throw e;
    }
    const entry = registry.entries[keyOf(want.account, want.region, identity.stage, identity.project)];
    // not under the expected key: registered under another account/region is a mismatch, else not registered.
    if (!entry) {
        const other = Object.values(registry.entries).some(
            e => e.identity.project === identity.project && e.identity.stage === identity.stage,
        );
        return other ? 'identity-mismatch' : 'not-registered';
    }
    if (
        entry.identity.project !== identity.project ||
        entry.identity.stage !== identity.stage ||
        entry.identity.stack !== identity.stack ||
        entry.account !== want.account ||
        entry.region !== want.region
    )
        return 'identity-mismatch';
    //* v5 B30 r2: the recorded run state must be settled (an unresolved run or an open reconcile blocks).
    if (entry.runState === 'unresolved' || entry.class === 'blocked' || entry.class === 'reconcile-required')
        return 'run-unresolved';
    // no run state is accepted only with a first-observation baseline.
    if (entry.runState === 'none' && entry.baselineKind !== 'first-observation') return 'run-unresolved';
    return null;
}

/**
 * run one write of a target under the guard:
 * 1. `classifyTarget` — outside the registry: `adapter.passthrough?.()` at once and no state I/O at all;
 * 2. `loadInstall` — a failure is `blocked` (`install-invalid`, `root-invalid`, `root-missing`, `root-mismatch`,
 *    `root-unsupported-volume`) and the adapter is not called;
 * 3. `acquireHostLock` — `LOCK_BUSY` is `blocked: 'busy'`;
 * 4. under the lock, `operationState` — not idle is `blocked: 'journal-unresolved'` (no write, no retry, no repair);
 * 5. the registry entry — none `blocked: 'not-registered'`, other stack/account/region `blocked: 'identity-mismatch'`,
 *    an unsettled run state `blocked: 'run-unresolved'`;
 * 6. journal `inflight` (fsync) → `adapter.write({ identity, operationId, signal })` → `completed`; a throw (or an
 *    invalid result) is recorded `unknown` (scrubbed message, 200 characters) and `WRITE_UNKNOWN` is thrown; when the
 *    journal itself cannot be written after the call, `WRITE_UNKNOWN` carries `stateWriteFailed: true` and the file
 *    may stay `inflight` (the rename may have landed while the directory fsync failed).
 * The install file is found by `installPath` (env or default path). The lock is released in all cases.
 */
export async function guardedWrite({ input, expected, env = process.env, adapter, holder, signal, deps } = {}) {
    const classified = classifyTarget(input, deps);
    // N14: a general deploy keeps its own path; nothing of the guard is read or opened.
    if (classified.applicability === 'not-applicable')
        return {
            applicability: 'not-applicable',
            reason: classified.reason,
            adapterResult: await adapter?.passthrough?.(),
        };
    if (!object(adapter) || typeof adapter.write !== 'function')
        fail('INVALID_INPUT', 'A guarded write needs an adapter with write().');
    const want = expectedOf(expected);
    const who = holderOf(holder);
    const { identity } = classified;
    const blocked = reason => ({ applicability: 'applicable', status: 'blocked', reason, identity });
    const { inst, reason } = await installOrReason({ env, deps });
    if (reason) return blocked(reason);
    let lock;
    try {
        lock = await acquireHostLock({ port: inst.port, holder: who, deps });
    } catch (e) {
        if (e?.code === 'LOCK_BUSY') return blocked('busy');
        throw e;
    }
    try {
        const why = await preflight(inst, identity, want, deps);
        if (why) return blocked(why);
        const { fs, now } = io(deps);
        const operationId = randomUUID();
        const started = now();
        const file = path.join(inst.root, ROOT_FILES.journal, `${stampOf(started)}-${operationId}.json`);
        const record = {
            schemaVersion: 1,
            operationId,
            identity: { ...identity },
            holder: who,
            startedAt: started.toISOString(),
            state: 'inflight',
            requestIds: [],
        };
        // the inflight record is on disk before the adapter is called.
        await writeAtomic(fs, file, record);
        // the one error of an unknown end (never the adapter's text); `stateWriteFailed` when the journal failed too.
        const unknownError = stateWriteFailed => {
            const err = new MigrationError(
                'WRITE_UNKNOWN',
                stateWriteFailed
                    ? 'The write ended and its journal record may not be durable; the operation may stay inflight.'
                    : 'The write did not complete; the journal records it as unknown until it is resolved.',
                { unknown: true },
            );
            err.operationId = operationId;
            if (stateWriteFailed) err.stateWriteFailed = true;
            return err;
        };
        // v5 B30 r2: a journal write after the adapter call that fails leaves the file inflight (WRITE_UNKNOWN).
        const writeEnd = async value => {
            try {
                await writeAtomic(fs, file, value);
            } catch {
                throw unknownError(true);
            }
        };
        // an unknown end: recorded, then one error without the adapter's text.
        const unknown = async error => {
            await writeEnd({ ...record, state: 'unknown', endedAt: now().toISOString(), error });
            throw unknownError(false);
        };
        let result;
        try {
            result = await adapter.write({ identity, operationId, signal });
        } catch (e) {
            await unknown({ code: errorCodeOf(e), message: scrub(e?.message ?? e) });
        }
        const done = resultOf(result);
        if (!done)
            await unknown({ code: 'ADAPTER_RESULT_INVALID', message: 'The adapter returned an invalid result.' });
        // completed: the same file is replaced atomically.
        await writeEnd({ ...record, ...done, state: 'completed', endedAt: now().toISOString() });
        return { applicability: 'applicable', status: 'completed', operationId, identity };
    } finally {
        await lock.release();
    }
}

/**
 * the read-only status of a target (for `plan`): steps 1–2 and 4–5 of `guardedWrite` without the lock and without
 * any write → `{ applicability: 'applicable', status: 'ready' | 'blocked', reason?, identity }`, or
 * `{ applicability: 'not-applicable', reason: 'outside-registry' }` with no state I/O at all.
 */
export async function guardStatus(input, expected, { env = process.env, deps } = {}) {
    const classified = classifyTarget(input, deps);
    if (classified.applicability === 'not-applicable')
        return { applicability: 'not-applicable', reason: classified.reason };
    const want = expectedOf(expected);
    const { identity } = classified;
    const blocked = reason => ({ applicability: 'applicable', status: 'blocked', reason, identity });
    const { inst, reason } = await installOrReason({ env, deps });
    if (reason) return blocked(reason);
    const why = await preflight(inst, identity, want, deps);
    return why ? blocked(why) : { applicability: 'applicable', status: 'ready', identity };
}

//* ---- G. writer wiring (v5 B31) ----

//* v5 B31: the one fixed sentence of a blocked write (no reason detail, no value).
export const GUARD_BLOCKED_MESSAGE =
    'The migration guard blocked this write; check lemon-lambda-guard status before any retry.';

/** a blocked guarded write as the error the writer entries report (`GUARD_BLOCKED`, exit 1, `guardReason`). */
export function guardBlockedError(reason) {
    const error = new MigrationError('GUARD_BLOCKED', GUARD_BLOCKED_MESSAGE);
    error.guardReason = reason;
    error.exitCode = 1;
    return error;
}

/** the one-line stderr report of a blocked write: `{ status, code, reason, message }`. */
export const blockedReport = error => ({
    status: 'blocked',
    code: 'GUARD_BLOCKED',
    reason: error.guardReason,
    message: GUARD_BLOCKED_MESSAGE,
});

/** the guard fields a writer adds to its failure report (none for a write that never reached the journal). */
export const guardErrorFields = error => ({
    ...(typeof error?.operationId === 'string' ? { operationId: error.operationId } : {}),
    ...(error?.stateWriteFailed === true ? { stateWriteFailed: true } : {}),
});

/**
 * the guard summary of a dry-run plan: `undefined` outside the registry (classification only, no state I/O), else
 * `{ applicability, status: 'ready' | 'blocked', reason? }` from `guardStatus` (read-only, no lock).
 */
export async function planGuard(input, expected, { env = process.env, deps } = {}) {
    const status = await guardStatus(input, expected, { env, deps });
    if (status.applicability === 'not-applicable') return undefined;
    return {
        applicability: status.applicability,
        status: status.status,
        ...(status.reason ? { reason: status.reason } : {}),
    };
}

// the journal result of a writer result: its deploy id as a request id when it has the id form, else nothing.
const writeResultOf = result =>
    typeof result?.deployId === 'string' && REQUEST_ID_RE.test(result.deployId)
        ? { requestIds: [result.deployId] }
        : undefined;

/**
 * run a writer's existing write function `run()` under the guard (`guardedWrite`, holder = the tool name):
 * - outside the registry: `run()` as passthrough, `{ result }` (no guard field, no state I/O);
 * - blocked: throws `guardBlockedError(reason)` before `run()` (no receipt, credential, network or lock file);
 * - completed: `{ result, guard: { operationId, journal: 'completed' } }`;
 * - `run()` threw: its own error is re-thrown with `operationId` (the journal records it `unknown`); with
 *   `stateWriteFailed` it is also made unknown (exit 3);
 * - `run()` returned but the journal could not be written: `WRITE_UNKNOWN` (exit 3) with `operationId`,
 *   `stateWriteFailed` and the result's `receipt` / `deployId`.
 */
export async function runGuarded({ input, expected, holder, run, env = process.env, deps, signal } = {}) {
    let outcome;
    // the write keeps its own result or error for the report; the guard sees only the journal form.
    const write = async () => {
        try {
            outcome = { result: await run() };
        } catch (error) {
            outcome = { error };
            throw error;
        }
        return writeResultOf(outcome.result);
    };
    let guarded;
    try {
        guarded = await guardedWrite({
            input,
            expected,
            env,
            holder,
            signal,
            deps,
            adapter: { passthrough: run, write },
        });
    } catch (e) {
        if (e?.code !== 'WRITE_UNKNOWN' || typeof e.operationId !== 'string') throw e;
        // the writer's own error (code, receipt, diagnostic, exit code) plus the operation id.
        if (outcome?.error) {
            const error = outcome.error;
            error.operationId = e.operationId;
            if (e.stateWriteFailed) Object.assign(error, { stateWriteFailed: true, unknown: true, exitCode: 3 });
            throw error;
        }
        // the write returned (or never ran) and the journal is uncertain.
        e.exitCode = 3;
        if (typeof outcome?.result?.receipt === 'string') e.receipt = outcome.result.receipt;
        if (typeof outcome?.result?.deployId === 'string') e.deployId = outcome.result.deployId;
        throw e;
    }
    if (guarded.applicability === 'not-applicable') return { result: guarded.adapterResult };
    if (guarded.status === 'blocked') throw guardBlockedError(guarded.reason);
    return { result: outcome.result, guard: { operationId: guarded.operationId, journal: 'completed' } };
}
