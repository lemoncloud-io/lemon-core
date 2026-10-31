/**
 * `bin/lib/migrate-inspect.mjs` (lemon-core)
 * - the follow-up commands of `lemon-lambda-migrate` for a stack that was already migrated (v5 B27):
 *   `inspect` (read-only live inventory), `reconcile` (offline comparison with the run baseline) and `resolve`
 *   (a local attestation of an owner decision on the setting DIFF of an unknown verify).
 * - never mutates a target AWS resource: STS identity and Describe/Get/List calls only (an allowlist), HTTP probes
 *   only with `--http-probe`. Never writes the receipt, the owner file, the lock or a snapshot file.
 * - stdout carries names, counts and status only: no value, no ARN, no account. Env values stay in memory for the
 *   comparison with the private backup; only key names, categories and counts are stored.
 * - see `docs/v5/B27-migrate-inspect.md`.
 */
//* v5 B27: new module (inspect / reconcile / resolve); the six migration phases are unchanged.
import { lstat, open, readFile, realpath, unlink, mkdir, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ORG_DEFAULTS } from './org-defaults.mjs';
import { runPrivateChild } from './migrate-process.mjs';
import { compareEnvironment } from './lambda-env.mjs';
import {
    MigrationError,
    PHASES,
    json,
    migrationTarget,
    validateMigrationConfig,
    validateRepository,
    targetEnvironment,
    rejectPlaceholders,
    fingerprint,
    privateEntry,
    noSymlinkChain,
    validateOwned,
} from './migrate-core.mjs';

// the migration pins (run-state dir of the checkout).
const MIGRATION = ORG_DEFAULTS.migration;

// the doc that help and error texts point to.
export const DOC_REF = 'docs/v5/B27-migrate-inspect.md';

// the follow-up commands (first argument of `lemon-lambda-migrate`).
export const INSPECTION_COMMANDS = Object.freeze(['inspect', 'reconcile', 'resolve', 'adopt-baseline']);

// an inventory older than this is stale for `reconcile` and `resolve` (1 h).
export const STALE_AFTER_MS = 60 * 60 * 1000;

// an inventory dated later than now by more than this is stale too (clock skew bound, 5 min).
const FUTURE_SKEW_MS = 5 * 60 * 1000;

// the result classes of `reconcile`.
export const CLASSES = Object.freeze(['verified-no-op', 'reconcile-required', 'blocked']);

// the reason codes of a `blocked` result.
export const REASONS = Object.freeze([
    'no-baseline',
    'stack-present',
    'read-error',
    'inventory-stale',
    'receipt-unknown-unresolved',
    'target-mismatch',
    'baseline-changed',
    'cf-owned-resource',
    'ambiguous-discovery',
]);

// the run states `reconcile` reports next to the original receipt status.
export const RUN_STATES = Object.freeze(['completed', 'resolved-observed-diff', 'unresolved']);

// the `kind` of each control record.
export const KINDS = Object.freeze({
    inventory: 'lemon-lambda-migrate/inventory',
    reconcile: 'lemon-lambda-migrate/reconcile',
    resolution: 'local-attestation',
    baseline: 'local-attestation',
});

// the private sub-directories of the run dir that hold the control records (0700, files 0600).
export const RECORD_DIRS = Object.freeze({ inventory: 'inspections', resolution: 'resolutions' });

// the only settings a resolution may accept: non-secret scalars (section -> fields).
export const RESOLVABLE = Object.freeze({ logGroups: ['retention'], functions: ['memory', 'timeout'] });

// per-call bounds of the read-only calls.
const AWS_TIMEOUT_MS = 30000;
const HTTP_TIMEOUT_MS = 10000;
// the largest control record / deploy receipt read (16 MiB) and the most identities per baseline section.
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_IDS = 100;

// sha256 hex (same rule as `migrate-core.mjs`).
const hash = x => createHash('sha256').update(x).digest('hex');
// canonical JSON (same rule as `migrate-core.mjs`).
const canonical = x => JSON.stringify(x);
// the plain-object test.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
// throw a known error (message without values).
const fail = (code, message) => {
    throw new MigrationError(code, message);
};
// an ISO time.
const iso = date => date.toISOString();
// the file-name stamp of a time (`20261101T120000123Z`).
const stampOf = date => iso(date).replace(/[-:.]/g, '');
// the last `:`/`/` segment of an ARN (the resource name).
const arnName = arn => `${arn}`.split(/[:/]/).pop();
// a literal string as a regular expression source.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the public identity of a target (`project`, `stage`, `stack`).
const identityOf = t => ({ project: t.project, stage: t.stage, stack: t.stack });
// the two functions of a target stack.
const functionNames = t => [`${t.stack}-lambda`, `${t.stack}-backend`];

//* ---- read-only AWS CLI calls ----

/** the only AWS CLI operations `inspect` may run: sourceApi -> [service, operation] (Describe/Get/List). */
export const READS = Object.freeze({
    'cloudformation:DescribeStacks': ['cloudformation', 'describe-stacks'],
    'cloudformation:DescribeStackResources': ['cloudformation', 'describe-stack-resources'],
    'lambda:GetFunctionConfiguration': ['lambda', 'get-function-configuration'],
    'lambda:ListTags': ['lambda', 'list-tags'],
    'lambda:ListEventSourceMappings': ['lambda', 'list-event-source-mappings'],
    'dynamodb:DescribeTable': ['dynamodb', 'describe-table'],
    'sqs:GetQueueUrl': ['sqs', 'get-queue-url'],
    'sqs:GetQueueAttributes': ['sqs', 'get-queue-attributes'],
    'sns:GetTopicAttributes': ['sns', 'get-topic-attributes'],
    'sns:ListSubscriptionsByTopic': ['sns', 'list-subscriptions-by-topic'],
    's3:HeadBucket': ['s3api', 'head-bucket'],
    's3:ListBuckets': ['s3api', 'list-buckets'],
    's3:ListObjectsV2': ['s3api', 'list-objects-v2'],
    's3:GetBucketWebsite': ['s3api', 'get-bucket-website'],
    's3:GetBucketPolicy': ['s3api', 'get-bucket-policy'],
    'logs:DescribeLogGroups': ['logs', 'describe-log-groups'],
    'apigateway:GetResources': ['apigateway', 'get-resources'],
    'apigateway:GetStages': ['apigateway', 'get-stages'],
    //* v5 B27-b: the extra reads of `inspect --discover` (first-observation baseline).
    'sns:ListSubscriptions': ['sns', 'list-subscriptions'],
    'tag:GetResources': ['resourcegroupstaggingapi', 'get-resources'],
    'apigateway:GetRestApi': ['apigateway', 'get-rest-api'],
    'lambda:GetEventSourceMapping': ['lambda', 'get-event-source-mapping'],
});

// AWS error codes classified as `throttling` / `access-denied`; anything else unexpected is `other`.
const THROTTLING = new Set([
    'Throttling',
    'ThrottlingException',
    'ThrottledException',
    'TooManyRequestsException',
    'RequestLimitExceeded',
    'RequestThrottled',
    'RequestThrottledException',
    'SlowDown',
]);
const ACCESS_DENIED = new Set([
    'AccessDenied',
    'AccessDeniedException',
    'UnauthorizedOperation',
    'AuthorizationError',
    'Forbidden',
    '403',
]);

/** the fixed error kind of a failed AWS CLI call; the raw text stays inside this module, never in a record. */
export function awsFailure(error) {
    const raw = error?.stderr;
    const stderr = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : '';
    const code = /An error occurred \(([A-Za-z0-9._-]{1,128})\)/.exec(stderr)?.[1];
    // a killed child (execFile `timeout`) or a timed-out socket is a timeout, whatever it printed.
    if (error?.killed || error?.code === 'ETIMEDOUT' || error?.name === 'TimeoutError')
        return { kind: 'timeout', stderr };
    if (code && THROTTLING.has(code)) return { kind: 'throttling', code, stderr };
    if (code && ACCESS_DENIED.has(code)) return { kind: 'access-denied', code, stderr };
    return { kind: 'other', ...(code ? { code } : {}), stderr };
}

/**
 * the reader of `inspect`: one AWS CLI v2 call (`execFile`, JSON out) with the config profile/region and the
 * scrubbed target environment (`targetEnvironment`, as for the canonical script).
 * - returns `{ state: 'value', value }`, `{ state: 'absent' }` (only for an `absent` rule), `{ state: 'empty' }`
 *   (an `empty` code: "no such sub-configuration") or `{ state: 'error', errorKind, errorCode? }`, each with
 *   `sourceApi` and `observedAt`.
 * - `exec` is injectable (tests: a fake `aws`); only a `READS` operation can be called.
 */
export function awsReader(c, { exec, environment = process.env, now = () => new Date(), deadline, signal } = {}) {
    const run = exec ?? promisify(execFile);
    const env = targetEnvironment(c, environment);
    const until = deadline ?? Date.now() + c.timeoutMs;
    return async (sourceApi, args, { absent = [], empty = [] } = {}) => {
        const op = READS[sourceApi];
        if (!op) fail('READ_NOT_ALLOWED', 'Only reviewed read-only AWS calls are allowed.');
        const remaining = until - Date.now();
        // the run deadline also bounds the reads: past it, nothing more is called.
        if (remaining <= 0) return { state: 'error', errorKind: 'timeout', sourceApi, observedAt: iso(now()) };
        try {
            const { stdout } = await run(
                'aws',
                [...op, ...args, '--profile', c.profile, '--region', c.region, '--output', 'json', '--no-cli-pager'],
                {
                    env,
                    encoding: 'utf8',
                    timeout: Math.min(AWS_TIMEOUT_MS, remaining),
                    maxBuffer: MAX_FILE_BYTES,
                    ...(signal ? { signal } : {}),
                },
            );
            const text = String(stdout ?? '').trim();
            return { state: 'value', value: text ? JSON.parse(text) : {}, sourceApi, observedAt: iso(now()) };
        } catch (error) {
            if (signal?.aborted) fail('INTERRUPTED', 'Inspection interrupted; no inventory was written.');
            const failure = awsFailure(error);
            const observedAt = iso(now());
            // `absent` only for an exact rule (code, and message when given); an error is never absence.
            if (absent.some(r => r.code === failure.code && (!r.message || r.message.test(failure.stderr))))
                return { state: 'absent', sourceApi, observedAt };
            if (failure.code && empty.includes(failure.code)) return { state: 'empty', sourceApi, observedAt };
            return {
                state: 'error',
                errorKind: failure.kind,
                ...(failure.code ? { errorCode: failure.code } : {}),
                sourceApi,
                observedAt,
            };
        }
    };
}

//* ---- observation records ----

// one observed field: its value (or `unset: true`), with the API and time it came from.
const fieldOf = (read, value, extra = {}) => ({
    ...(value === undefined ? { unset: true } : { value }),
    ...extra,
    sourceApi: read.sourceApi,
    observedAt: read.observedAt,
});
// a failed read as a field / resource record (kind and code only).
const errorOf = (read, errorKind = read.errorKind) => ({
    state: 'error',
    errorKind,
    ...(read.errorCode && errorKind === read.errorKind ? { errorCode: read.errorCode } : {}),
    sourceApi: read.sourceApi,
    observedAt: read.observedAt,
});
// a non-value read as a resource record (`absent` or `error`).
const resourceOf = read =>
    read.state === 'absent'
        ? { state: 'absent', sourceApi: read.sourceApi, observedAt: read.observedAt }
        : errorOf(read);
// the deploy-* tags only (other tags are not recorded).
const deployTags = tags =>
    Object.fromEntries(
        Object.entries(object(tags) ? tags : {})
            .filter(([k]) => k.startsWith('deploy-'))
            .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
// event source mappings: uuid, source ARN, state, batch size, starting position (sorted by uuid).
const normalizeEsm = list =>
    (Array.isArray(list) ? list : [])
        .map(m => ({
            uuid: m?.UUID,
            sourceArn: m?.EventSourceArn,
            state: m?.State,
            batchSize: m?.BatchSize,
            ...(m?.StartingPosition ? { startingPosition: m.StartingPosition } : {}),
        }))
        .sort((a, b) => (`${a.uuid}` < `${b.uuid}` ? -1 : 1));
// a key schema as `[{ attributeName, keyType }]` sorted by key type (HASH, RANGE); undefined when malformed.
export const normalizeKeySchema = list =>
    Array.isArray(list) &&
    list.length &&
    list.every(k => typeof k?.AttributeName === 'string' && typeof k?.KeyType === 'string')
        ? list
              .map(k => ({ attributeName: k.AttributeName, keyType: k.KeyType }))
              .sort((a, b) => (a.keyType < b.keyType ? -1 : 1))
        : undefined;
// a plain object of string values (a Lambda environment).
const stringMap = x => object(x) && Object.values(x).every(v => typeof v === 'string');

/**
 * compare the live environment with the private backup (`env.json` of the run) in memory, by key.
 * - categories: `same`, `changed`, `backupOnly`, `liveOnly`, and `notComparable` (a KMS ciphertext `*AQIC…` on
 *   either side: it changes per encryption). Names and counts only; no value, no hash of a value.
 */
export function envCategories(backup, live) {
    const d = compareEnvironment(backup, live);
    const cipher = new Set([...d.encryptedKeys.same, ...d.encryptedKeys.changed]);
    const categories = {
        same: d.same.filter(k => !cipher.has(k)),
        changed: d.changed.filter(k => !cipher.has(k)),
        backupOnly: d.new,
        liveOnly: d.liveOnly,
        notComparable: [...cipher].sort(),
    };
    return { categories, counts: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.length])) };
}

// observe one function: configuration, State/LastUpdateStatus, env keys and env categories, deploy-* tags, mappings.
async function observeFunction(read, c, name, backup) {
    const r = await read('lambda:GetFunctionConfiguration', ['--function-name', name], {
        absent: [{ code: 'ResourceNotFoundException' }],
    });
    if (r.state !== 'value') return resourceOf(r);
    const v = object(r.value) ? r.value : {};
    const arn = `arn:aws:lambda:${c.region}:${c.account}:function:${name}`;
    // a function outside the configured account/region is a target mismatch, not an observation.
    if (v.FunctionArn !== arn && v.FunctionArn !== `${arn}:$LATEST`) return errorOf(r, 'target-mismatch');
    // a field of this configuration read.
    const f = value => fieldOf(r, value);
    const fields = {
        runtime: f(v.Runtime),
        architecture: f(Array.isArray(v.Architectures) ? v.Architectures[0] : undefined),
        handler: f(v.Handler),
        memory: f(v.MemorySize),
        timeout: f(v.Timeout),
        codeSha: f(v.CodeSha256),
        lastModified: f(v.LastModified),
        roleArn: f(v.Role),
        state: f(v.State),
        lastUpdateStatus: f(v.LastUpdateStatus),
    };
    // env: key names, and the in-memory comparison with the backup; the values are dropped here.
    const variables = v.Environment?.Variables;
    if (v.Environment?.Error || (variables !== undefined && !stringMap(variables))) {
        fields.envKeys = errorOf(r, 'other');
        fields.env = errorOf(r, 'other');
    } else {
        const live = variables ?? {};
        fields.envKeys = f(Object.keys(live).sort());
        if (!stringMap(backup)) fields.env = { state: 'no-backup', sourceApi: r.sourceApi, observedAt: r.observedAt };
        else {
            const { categories, counts } = envCategories(backup, live);
            fields.env = fieldOf(r, categories, { counts, backup: 'env.json' });
        }
    }
    const tags = await read('lambda:ListTags', ['--resource', v.FunctionArn]);
    fields.tags = tags.state === 'value' ? fieldOf(tags, deployTags(tags.value?.Tags)) : errorOf(tags);
    const esm = await read('lambda:ListEventSourceMappings', ['--function-name', name]);
    fields.eventSourceMappings =
        esm.state === 'value' ? fieldOf(esm, normalizeEsm(esm.value?.EventSourceMappings)) : errorOf(esm);
    return { state: 'present', fields };
}

// the ARN rule of a CloudFormation stack id in the configured account/region.
const stackArnRe = c =>
    new RegExp(`^arn:aws:cloudformation:${c.region}:${c.account}:stack/[A-Za-z0-9-]+/[A-Za-z0-9-]+$`);

/**
 * which CloudFormation stack owns a retained resource (`describe-stack-resources --physical-resource-id`).
 * - the exact "Stack for <id> does not exist" ValidationError is `none`; a listed stack that is `DELETE_COMPLETE`
 *   is `none` with that trace; any other listed stack is `stack`; any other error is a read error.
 */
async function observeCfOwner(read, c, physicalId) {
    const r = await read('cloudformation:DescribeStackResources', ['--physical-resource-id', physicalId], {
        absent: [{ code: 'ValidationError', message: new RegExp(`Stack for ${escapeRe(physicalId)} does not exist`) }],
    });
    if (r.state === 'absent') return fieldOf(r, 'none');
    if (r.state !== 'value') return errorOf(r);
    const ids = [...new Set((r.value?.StackResources ?? []).map(x => x?.StackId))];
    let trace;
    for (const id of ids) {
        if (typeof id !== 'string' || !stackArnRe(c).test(id)) return errorOf(r, 'target-mismatch');
        const s = await read('cloudformation:DescribeStacks', ['--stack-name', id]);
        if (s.state !== 'value') return errorOf(s);
        const status = s.value?.Stacks?.[0]?.StackStatus;
        if (status !== 'DELETE_COMPLETE')
            return fieldOf(s, 'stack', { stackStatus: typeof status === 'string' ? status : 'unknown' });
        trace = 'DELETE_COMPLETE';
    }
    return fieldOf(r, 'none', trace ? { trace } : {});
}

// observe one retained table: identity axes (ARN, id, creation time, key schema, stream) and the approximate count.
async function observeTable(read, c, name) {
    const r = await read('dynamodb:DescribeTable', ['--table-name', name], {
        absent: [{ code: 'ResourceNotFoundException' }],
    });
    if (r.state !== 'value') return resourceOf(r);
    const t = object(r.value?.Table) ? r.value.Table : {};
    return {
        state: 'present',
        fields: {
            arn: fieldOf(r, t.TableArn),
            id: fieldOf(r, t.TableId),
            created: fieldOf(r, t.CreationDateTime),
            keySchema: fieldOf(r, normalizeKeySchema(t.KeySchema)),
            stream: fieldOf(r, t.LatestStreamArn),
            items: fieldOf(r, t.ItemCount, { approximate: true }),
            cfOwner: await observeCfOwner(read, c, name),
        },
    };
}

// observe one retained queue: URL (checked against the account/region), creation time, approximate messages.
async function observeQueue(read, c, name) {
    const u = await read('sqs:GetQueueUrl', ['--queue-name', name], {
        absent: [{ code: 'AWS.SimpleQueueService.NonExistentQueue' }, { code: 'QueueDoesNotExist' }],
    });
    if (u.state !== 'value') return resourceOf(u);
    const url = u.value?.QueueUrl;
    if (url !== `https://sqs.${c.region}.amazonaws.com/${c.account}/${name}`) return errorOf(u, 'target-mismatch');
    const a = await read('sqs:GetQueueAttributes', [
        '--queue-url',
        url,
        '--attribute-names',
        'CreatedTimestamp',
        'ApproximateNumberOfMessages',
    ]);
    const attrs = a.state === 'value' && object(a.value?.Attributes) ? a.value.Attributes : {};
    return {
        state: 'present',
        fields: {
            url: fieldOf(u, url),
            created: a.state === 'value' ? fieldOf(a, attrs.CreatedTimestamp) : errorOf(a),
            messages:
                a.state === 'value' ? fieldOf(a, attrs.ApproximateNumberOfMessages, { approximate: true }) : errorOf(a),
            cfOwner: await observeCfOwner(read, c, url),
        },
    };
}

// observe one retained topic: subscription count (as the canonical snapshot), and the protocol/endpoint list.
async function observeTopic(read, c, arn) {
    const a = await read('sns:GetTopicAttributes', ['--topic-arn', arn], {
        absent: [{ code: 'NotFound' }, { code: 'NotFoundException' }],
    });
    if (a.state !== 'value') return resourceOf(a);
    const attrs = object(a.value?.Attributes) ? a.value.Attributes : {};
    const count = Number(attrs.SubscriptionsConfirmed) + Number(attrs.SubscriptionsPending);
    const l = await read('sns:ListSubscriptionsByTopic', ['--topic-arn', arn]);
    const endpoints = (Array.isArray(l.value?.Subscriptions) ? l.value.Subscriptions : [])
        .map(s => ({ protocol: s?.Protocol, endpoint: s?.Endpoint }))
        .sort((x, y) => (canonical(x) < canonical(y) ? -1 : 1));
    return {
        state: 'present',
        fields: {
            subscriptions: fieldOf(a, Number.isFinite(count) ? count : null),
            endpoints: l.state === 'value' ? fieldOf(l, endpoints, { count: endpoints.length }) : errorOf(l),
            cfOwner: await observeCfOwner(read, c, arn),
        },
    };
}

// observe one retained bucket: creation date, object count (max 1000), website and policy statement ids.
async function observeBucket(read, c, name) {
    const head = await read('s3:HeadBucket', ['--bucket', name], {
        absent: [{ code: '404' }, { code: 'NoSuchBucket' }, { code: 'NotFound' }],
    });
    if (head.state !== 'value') return resourceOf(head);
    // there is no per-bucket API for the creation date: the account list, filtered to this bucket by the CLI.
    const list = await read('s3:ListBuckets', ['--query', `Buckets[?Name=='${name}']`]);
    const created = Array.isArray(list.value) ? list.value.find(x => x?.Name === name)?.CreationDate : undefined;
    const objects = await read('s3:ListObjectsV2', ['--bucket', name, '--max-keys', '1000', '--query', 'KeyCount']);
    const web = await read('s3:GetBucketWebsite', ['--bucket', name], { empty: ['NoSuchWebsiteConfiguration'] });
    const pol = await read('s3:GetBucketPolicy', ['--bucket', name], { empty: ['NoSuchBucketPolicy'] });
    let policySids;
    if (pol.state === 'empty') policySids = fieldOf(pol, []);
    else if (pol.state !== 'value') policySids = errorOf(pol);
    else
        try {
            const statements = JSON.parse(pol.value?.Policy).Statement;
            policySids = fieldOf(pol, (Array.isArray(statements) ? statements : [statements]).map(x => x.Sid).sort());
        } catch {
            policySids = errorOf(pol, 'other');
        }
    return {
        state: 'present',
        fields: {
            created: list.state === 'value' ? fieldOf(list, created) : errorOf(list),
            objects: objects.state === 'value' ? fieldOf(objects, objects.value) : errorOf(objects),
            website: ['value', 'empty'].includes(web.state) ? fieldOf(web, web.state === 'value') : errorOf(web),
            policySids,
            cfOwner: await observeCfOwner(read, c, name),
        },
    };
}

// observe one retained log group: creation time and retention (unset = never expire).
async function observeLogGroup(read, c, name) {
    const r = await read('logs:DescribeLogGroups', ['--log-group-name-prefix', name]);
    if (r.state !== 'value') return resourceOf(r);
    const found = (Array.isArray(r.value?.logGroups) ? r.value.logGroups : []).find(x => x?.logGroupName === name);
    if (!found) return { state: 'absent', sourceApi: r.sourceApi, observedAt: r.observedAt };
    return {
        state: 'present',
        fields: {
            created: fieldOf(r, found.creationTime),
            retention: fieldOf(r, found.retentionInDays),
            cfOwner: await observeCfOwner(read, c, name),
        },
    };
}

// observe the retained REST API: id, routes (`<METHOD> <path> <auth>`) and stage names, as the canonical snapshot.
async function observeApi(read, c, id) {
    const r = await read('apigateway:GetResources', ['--rest-api-id', id, '--embed', 'methods'], {
        absent: [{ code: 'NotFoundException' }],
    });
    if (r.state !== 'value') return resourceOf(r);
    const items = Array.isArray(r.value?.items) ? r.value.items : [];
    const routes = items
        .flatMap(x =>
            Object.entries(x?.resourceMethods ?? {}).map(([m, v]) => `${m} ${x.path} ${v?.authorizationType}`),
        )
        .sort();
    const s = await read('apigateway:GetStages', ['--rest-api-id', id]);
    const stages = (Array.isArray(s.value?.item) ? s.value.item : []).map(x => x?.stageName).sort();
    return {
        state: 'present',
        fields: {
            id: fieldOf(r, id),
            routes: fieldOf(r, routes),
            stages: s.state === 'value' ? fieldOf(s, stages) : errorOf(s),
            cfOwner: await observeCfOwner(read, c, id),
        },
    };
}

// GET the baseline public probe paths on the API stage URL (status only); app calls, so only with `--http-probe`.
async function probeHttp(c, apiId, paths, { fetch: get = globalThis.fetch, now, signal }) {
    const out = {};
    const base = `https://${apiId}.execute-api.${c.region}.amazonaws.com/${c.stage}`;
    for (const p of paths) {
        try {
            const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
            const res = await get(base + p, {
                method: 'GET',
                redirect: 'manual',
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            });
            await res.body?.cancel?.().catch(() => {});
            out[p] = { value: res.status, appCall: true, sourceApi: 'https:GET', observedAt: iso(now()) };
        } catch (error) {
            if (signal?.aborted) fail('INTERRUPTED', 'Inspection interrupted; no inventory was written.');
            out[p] = {
                state: 'error',
                errorKind: error?.name === 'TimeoutError' ? 'timeout' : 'other',
                appCall: true,
                sourceApi: 'https:GET',
                observedAt: iso(now()),
            };
        }
    }
    return out;
}

//* ---- run state (read-only) ----

// the identity rules of the baseline sections (checked before an identity reaches the AWS CLI).
const ID_RULES = c => ({
    tables: /^[A-Za-z0-9_.][A-Za-z0-9_.-]{2,254}$/,
    queues: /^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}(\.fifo)?$/,
    topics: new RegExp(`^arn:aws:sns:${c.region}:${c.account}:[A-Za-z0-9_][A-Za-z0-9_-]{0,255}(\\.fifo)?$`),
    buckets: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
    logGroups: /^[A-Za-z0-9_./#][A-Za-z0-9_./#-]{0,511}$/,
});
// a baseline HTTP probe path: absolute, plain characters, no `.`/`..` segment.
const PROBE_RE = /^\/[A-Za-z0-9._~:@/-]{0,512}$/;

/** the retained identities of a baseline (`after.json`/`before.json` shape), validated; none without a baseline. */
export function baselineIdentities(baseline, c) {
    const ids = { tables: [], queues: [], topics: [], buckets: [], logGroups: [], api: null, http: [] };
    if (!baseline) return ids;
    for (const [section, re] of Object.entries(ID_RULES(c))) {
        const keys = Object.keys(object(baseline[section]) ? baseline[section] : {});
        if (keys.length > MAX_IDS || keys.some(k => !re.test(k)))
            fail('SNAPSHOT_INVALID', `Invalid ${section} identity in the run baseline.`);
        ids[section] = keys.sort();
    }
    if (baseline.api != null) {
        if (!object(baseline.api) || typeof baseline.api.id !== 'string' || !/^[a-z0-9]{1,32}$/.test(baseline.api.id))
            fail('SNAPSHOT_INVALID', 'Invalid API identity in the run baseline.');
        ids.api = baseline.api.id;
    }
    const probes = Object.keys(object(baseline.http) ? baseline.http : {});
    if (probes.length > MAX_IDS || probes.some(p => !PROBE_RE.test(p) || /\/\.\.?(\/|$)/.test(p)))
        fail('SNAPSHOT_INVALID', 'Invalid HTTP probe path in the run baseline.');
    ids.http = probes.sort();
    return ids;
}

// parse a JSON snapshot file of the run (an object), else SNAPSHOT_INVALID.
const parseSnapshot = (bytes, name) => {
    let value;
    try {
        value = JSON.parse(bytes.toString('utf8'));
    } catch {
        fail('SNAPSHOT_INVALID', `Run file ${name} is not valid JSON.`);
    }
    if (!object(value)) fail('SNAPSHOT_INVALID', `Run file ${name} is not a JSON object.`);
    return value;
};

/**
 * the owned run state of the config, read only: run dir, receipt (integrity-checked) and its file sha256, lock
 * flag, the snapshot files with their sha256, and the baseline (`after.json`, else `before.json`).
 * - `requireRun: false` returns `{ present: false }` when the run dir does not exist (offline plan).
 */
export async function readRunState(c, { requireRun = true } = {}) {
    const target = migrationTarget(c);
    const rel = `${MIGRATION.runsDir}/${target.stack}`;
    const run = path.join(c.migrationRepo, rel);
    await noSymlinkChain(c.migrationRepo, rel);
    if (!(await lstat(run).catch(() => null))) {
        if (requireRun)
            fail(
                'RUN_STATE_MISSING',
                'No migration run state exists for this target; these commands need a migrated run.',
            );
        return { run, target, present: false };
    }
    // the owner file, the receipt integrity, the config and the 0700/0600 tree, as every phase checks them.
    const receipt = await validateOwned(run, c);
    const receiptSha256 = hash(await readFile(path.join(run, target.receiptFile)));
    const lockPresent = Boolean(await lstat(path.join(run, target.lockFile)).catch(() => null));
    const files = {},
        values = {};
    for (const name of ['plan.json', 'env.json', 'before.json', 'after.json']) {
        const bytes = await readFile(path.join(run, name)).catch(error =>
            error?.code === 'ENOENT' ? null : fail('PRIVATE_STATE_INVALID', `Cannot read run file ${name}.`),
        );
        if (!bytes) continue;
        files[name] = { sha256: hash(bytes) };
        // env.json holds values: it is parsed only where `inspect` compares in memory.
        if (name === 'env.json') files[name].bytes = bytes;
        else values[name] = parseSnapshot(bytes, name);
    }
    const name = values['after.json'] ? 'after.json' : values['before.json'] ? 'before.json' : null;
    return {
        run,
        target,
        present: true,
        receipt,
        receiptSha256,
        lockPresent,
        files,
        plan: values['plan.json'] ?? null,
        before: values['before.json'] ?? null,
        after: values['after.json'] ?? null,
        baseline: name ? { file: name, sha256: files[name].sha256, value: values[name] } : null,
    };
}

// how the receipt snapshot hashes bind a run file: `bound`, `unbound` (never recorded), `changed` or `missing`.
export const bindingOf = (state, name) =>
    !state.files[name]
        ? 'missing'
        : !Object.hasOwn(object(state.receipt.snapshots) ? state.receipt.snapshots : {}, name)
        ? 'unbound'
        : state.receipt.snapshots[name] === state.files[name].sha256
        ? 'bound'
        : 'changed';
// the binding label of the baseline file (`bound-at-verify`, `unbound-at-verify`, `changed-after-plan`, ...).
const baselineBinding = state => (state.baseline ? bindingLabel(state, state.baseline.file) : 'none');
// the binding label of a snapshot file: after.json is written by `verify`, the others by `plan`.
const bindingLabel = (state, name) => {
    const at = name === 'after.json' ? 'verify' : 'plan';
    const b = bindingOf(state, name);
    return b === 'bound' ? `bound-at-${at}` : b === 'unbound' ? `unbound-at-${at}` : `${b}-after-${at}`;
};

// the env backup of the run (`{ <function>: { KEY: value } }`), parsed for the in-memory comparison only.
const envBackupOf = state => {
    if (!state.files['env.json']) return null;
    let value;
    try {
        value = JSON.parse(state.files['env.json'].bytes.toString('utf8'));
    } catch {
        fail('SNAPSHOT_INVALID', 'Run file env.json is not valid JSON.');
    }
    if (!object(value) || Object.values(value).some(v => !stringMap(v)))
        fail('SNAPSHOT_INVALID', 'Run file env.json must map each function to string values.');
    return value;
};

//* ---- control records (the only files these commands write) ----

// a private 0700 sub-directory of the run, created on demand; a symlink, a wrong owner or mode is refused.
async function recordDir(run, sub) {
    const dir = path.join(run, sub);
    if (!(await lstat(dir).catch(() => null))) {
        await mkdir(dir, { mode: 0o700 });
        await chmod(dir, 0o700);
    }
    await privateEntry(dir, 'dir');
    return dir;
}

/**
 * write one control record as a NEW file (`wx`: never an overwrite, append-only), mode 0600, with the receipt-style
 * envelope `{ payload, sha256 }`; `onWrite` (tests) sees its run-relative path.
 */
export async function writeRecord(run, sub, name, payload, onWrite) {
    const dir = sub ? await recordDir(run, sub) : run;
    const file = path.join(dir, name);
    let handle;
    try {
        handle = await open(file, 'wx', 0o600);
    } catch {
        fail('RECORD_EXISTS', 'A control record of this name exists already; records are never overwritten.');
    }
    try {
        await handle.chmod(0o600);
        await handle.writeFile(canonical({ payload, sha256: hash(canonical(payload)) }) + '\n');
        await handle.sync();
    } catch {
        await handle.close().catch(() => {});
        await unlink(file).catch(() => {});
        fail('RECORD_WRITE_FAILED', 'Could not write the control record.');
    }
    await handle.close();
    await privateEntry(file, 'file');
    onWrite?.(path.relative(run, file), file);
    return file;
}

/** read one control record of this run: a private file directly in `<run>/<sub>/`, envelope-checked, of `kind`. */
export async function readRecord(run, sub, file, kind, code) {
    const dir = path.join(run, sub);
    const abs = path.resolve(file);
    const real = await realpath(path.dirname(abs)).catch(() => null);
    if (real !== dir)
        fail(
            'INVALID_ARGS',
            `The ${sub || 'baseline'} record must be a file in ${sub || '.'}/ of this target's state.`,
        );
    await privateEntry(dir, 'dir');
    const at = path.join(dir, path.basename(abs));
    const st = await privateEntry(at, 'file');
    if (st.size > MAX_FILE_BYTES) fail(code, 'Control record is too large.');
    const bytes = await readFile(at);
    let envelope;
    try {
        envelope = JSON.parse(bytes.toString('utf8'));
    } catch {
        fail(code, 'Control record integrity check failed.');
    }
    const p = envelope?.payload;
    if (!object(p) || envelope.sha256 !== hash(canonical(p)) || p.schemaVersion !== 1 || p.kind !== kind)
        fail(code, 'Control record integrity check failed.');
    return { payload: p, sha256: hash(bytes), file: at, rel: sub ? `${sub}/${path.basename(at)}` : path.basename(at) };
}

//* ---- deploy receipts (code sha explanation) ----

/**
 * a completed `lemon-lambda-deploy` / `lemon-lambda-deploy-dev` receipt (`.artifacts/deploy/run-*\/receipt.json`).
 * - the B19 format has no hash envelope: integrity is the private-file rule (0600 file, 0700 dir, owned, no
 *   symlink, one link) plus the internal bindings (artifact key holds the sha256, succeeded+verified code steps
 *   and `end`, function ARNs of this stack). A tampered or incomplete receipt is refused (exit 2).
 * - returns `{ status: 'valid', sha256, codeSha, deployId, mode }`, or `{ status: 'other-target' }` for a valid
 *   receipt of another project/stage/installation.
 */
export async function readDeployReceipt(file, c) {
    const target = migrationTarget(c);
    // the one refusal of this reader (no detail: the receipt may hold other projects' names).
    const bad = () =>
        fail('DEPLOY_RECEIPT_INVALID', 'The deploy receipt is not a private, complete, consistent receipt.');
    const abs = path.resolve(file);
    const d = await lstat(path.dirname(abs)).catch(() => null);
    const s = await lstat(abs).catch(() => null);
    if (
        !d?.isDirectory() ||
        d.isSymbolicLink() ||
        (d.mode & 0o777) !== 0o700 ||
        !s?.isFile() ||
        s.isSymbolicLink() ||
        s.nlink !== 1 ||
        s.uid !== process.getuid() ||
        (s.mode & 0o777) !== 0o600 ||
        s.size > MAX_FILE_BYTES
    )
        bad();
    let r;
    try {
        r = JSON.parse(await readFile(abs, 'utf8'));
    } catch {
        bad();
    }
    const p = r?.plan,
        a = p?.artifact;
    const sha = a?.sha256;
    if (
        !object(r) ||
        r.schemaVersion !== 1 ||
        r.status !== 'completed' ||
        !object(p) ||
        p.schemaVersion !== 1 ||
        p.execution !== 'offline-plan' ||
        !['code', 'bootstrap'].includes(p.mode) ||
        !object(p.target) ||
        typeof sha !== 'string' ||
        !/^[a-f0-9]{64}$/.test(sha) ||
        typeof a.key !== 'string' ||
        !a.key.endsWith(`/${sha}.zip`) ||
        typeof r.deployId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(r.deployId) ||
        typeof r.manifestVersionId !== 'string' ||
        !Number.isFinite(Date.parse(r.finishedAt)) ||
        !Array.isArray(r.steps)
    )
        bad();
    // the receipt step of a name.
    const step = name => r.steps.find(x => x?.name === name);
    // a step that succeeded and was verified by the deploy service.
    const ok = x => x?.status === 'succeeded' && x.verified === true;
    if (!ok(step('end'))) bad();
    // a valid receipt of another target is reported, never used.
    const t = p.target;
    if (
        t.project !== c.project ||
        t.stage !== c.stage ||
        t.account !== c.account ||
        t.region !== c.region ||
        t.endpoint !== c.endpoint ||
        a.bucket !== c.artifactBucket
    )
        return { status: 'other-target' };
    const names = functionNames(target);
    const steps = p.mode === 'code' ? ['lambda-code', 'backend-code'] : ['lambda-function', 'backend-function'];
    // the function ARN of a name in the configured account/region.
    const arn = name => `arn:aws:lambda:${c.region}:${c.account}:function:${name}`;
    if (
        steps.some((n, i) => !ok(step(n)) || step(n).output?.functionArn !== arn(names[i])) ||
        !Array.isArray(r.functions) ||
        canonical(r.functions.map(x => x?.functionArn)) !== canonical(names.map(arn))
    )
        bad();
    return {
        status: 'valid',
        sha256: sha,
        codeSha: Buffer.from(sha, 'hex').toString('base64'),
        deployId: r.deployId,
        mode: p.mode,
    };
}

//* ---- comparison ----

/** equal values: JSON equality; a `created` time also by instant (the CLI prints times in the local zone). */
export function sameValue(field, a, b) {
    if (canonical(a) === canonical(b)) return true;
    if (field === 'created' && typeof a === 'string' && typeof b === 'string') {
        const x = Date.parse(a),
            y = Date.parse(b);
        return Number.isFinite(x) && x === y;
    }
    return false;
}

// the path of a baseline entry (`<section>/<name>/<field>`; a topic by its name, never its ARN).
const pathOf = (section, key, field) =>
    section === 'api'
        ? `api/${field}`
        : section === 'http'
        ? `http/${key}`
        : `${section}/${section === 'topics' ? arnName(key) : key}/${field}`;
// split a path into section, name and field (the name may hold `/`, e.g. a log group).
export const splitPath = p => {
    const first = p.indexOf('/'),
        last = p.lastIndexOf('/');
    if (first < 1 || last === first)
        return { section: p.slice(0, Math.max(first, 0)), name: '', field: p.slice(first + 1) };
    return { section: p.slice(0, first), name: p.slice(first + 1, last), field: p.slice(last + 1) };
};

/**
 * the DIFF set of the original canonical verify (`before.json` vs `after.json`, canonical field rules), without
 * the approximate `ItemCount` (B27: never a comparison axis). Entries `{ path, from, to }`.
 */
export function verifyDiff(before, after) {
    const out = [];
    // one compared field of the canonical verify.
    const push = (section, key, field, a, b) => {
        if (!sameValue(field, a, b)) out.push({ path: pathOf(section, key, field), from: a, to: b });
    };
    // the union of the keys of two snapshot entries (canonical compares whole objects).
    const keys = (a, b) =>
        [...new Set([...Object.keys(object(a) ? a : {}), ...Object.keys(object(b) ? b : {})])].sort();
    // one section of a snapshot (`{}` when missing).
    const sec = (v, s) => (object(v?.[s]) ? v[s] : {});
    for (const t of Object.keys(sec(before, 'tables')))
        push('tables', t, 'created', sec(before, 'tables')[t]?.created, sec(after, 'tables')[t]?.created);
    for (const q of Object.keys(sec(before, 'queues')))
        for (const f of keys(sec(before, 'queues')[q], sec(after, 'queues')[q]).filter(f => f !== 'messages'))
            push('queues', q, f, sec(before, 'queues')[q]?.[f], sec(after, 'queues')[q]?.[f]);
    for (const t of Object.keys(sec(before, 'topics')))
        push(
            'topics',
            t,
            'subscriptions',
            sec(before, 'topics')[t]?.subscriptions,
            sec(after, 'topics')[t]?.subscriptions,
        );
    for (const s of ['buckets', 'logGroups'])
        for (const k of Object.keys(sec(before, s)))
            for (const f of keys(sec(before, s)[k], sec(after, s)[k]))
                push(s, k, f, sec(before, s)[k]?.[f], sec(after, s)[k]?.[f]);
    for (const fn of Object.keys(sec(before, 'functions')))
        for (const f of keys(sec(before, 'functions')[fn], sec(after, 'functions')[fn]).filter(f => f !== 'runtime'))
            push('functions', fn, f, sec(before, 'functions')[fn]?.[f], sec(after, 'functions')[fn]?.[f]);
    if (before?.api)
        for (const f of keys(before.api, after?.api)) push('api', null, f, before.api?.[f], after?.api?.[f]);
    for (const p of Object.keys(sec(before, 'http')))
        if (!sameValue('http', sec(before, 'http')[p], sec(after, 'http')[p]))
            out.push({ path: pathOf('http', p), from: sec(before, 'http')[p], to: sec(after, 'http')[p] });
    return out;
}

// every `error` observation of an inventory, as `{ path, kind }` (resource-level and field-level).
export function inventoryErrors(inv) {
    const out = [];
    // one record: a resource / field / probe.
    const visit = (p, rec) => {
        if (!object(rec)) return;
        if (rec.state === 'error') out.push({ path: p, kind: rec.errorKind ?? 'other' });
        for (const [f, v] of Object.entries(object(rec.fields) ? rec.fields : {}))
            if (v?.state === 'error') out.push({ path: `${p}/${f}`, kind: v.errorKind ?? 'other' });
    };
    visit('stack', inv.stack);
    for (const s of ['functions', 'tables', 'queues', 'topics', 'buckets', 'logGroups'])
        for (const [k, v] of Object.entries(object(inv[s]) ? inv[s] : {}))
            visit(`${s}/${s === 'topics' ? arnName(k) : k}`, v);
    if (inv.api) visit('api', inv.api);
    for (const [p, v] of Object.entries(object(inv.http) ? inv.http : {})) visit(`http/${p}`, v);
    // v5 B27-b: the discovery reads of a `--discover` inventory.
    if (object(inv.discovery?.sources)) visit('discovery', { fields: inv.discovery.sources });
    return out;
}

// the observed value of one field of an inventory resource: `{ value }`, `{ error }` or `{ missing }`.
const liveOf = (res, field) => {
    if (!object(res)) return { missing: true };
    if (res.state === 'error') return { error: true };
    if (res.state === 'absent') return { value: undefined };
    const f = res.fields?.[field];
    if (f?.state === 'error') return { error: true };
    return { value: f?.value };
};

/**
 * compare the inventory with the baseline (and the config / plan / deploy receipt where they define the expected
 * value). Returns the compared entries, the approximate references, the axes compared and not compared.
 */
export function compareInventory({ c, target, inv, baseline, plan, deploy, mode = 'run' }) {
    const entries = [],
        approximate = {},
        code = {},
        env = {},
        cfOwned = [],
        scope = new Set(),
        notCompared = new Set();
    // compare one expected value with the observed field; read errors are counted elsewhere.
    const check = (axis, p, expected, live, field) => {
        if (live.error) return;
        scope.add(axis);
        const equal = !live.missing && sameValue(field, expected, live.value);
        entries.push({
            path: p,
            axis,
            equal,
            ...(live.missing ? { notObserved: true } : {}),
            expected,
            observed: live.value,
        });
    };
    // the CloudFormation owner of a present retained resource must be `none`.
    const owner = (p, res) => {
        if (res?.state !== 'present') return;
        const o = liveOf(res, 'cfOwner');
        if (o.error) return;
        scope.add('cloudformation-owner-of-retained-resources');
        if (o.value !== 'none') cfOwned.push(p);
    };
    const B = baseline;
    // one section of the baseline (`{}` when missing).
    const sec = s => (object(B?.[s]) ? B[s] : {});
    const names = functionNames(target);
    for (const fn of names) {
        const res = inv.functions?.[fn],
            b = sec('functions')[fn];
        for (const f of ['handler', 'memory', 'timeout'])
            check('function-config(handler,memory,timeout)', `functions/${fn}/${f}`, b?.[f], liveOf(res, f), f);
        check('function-env-keys', `functions/${fn}/envKeys`, b?.envKeys, liveOf(res, 'envKeys'), 'envKeys');
        // code: the baseline sha, or the artifact of a completed deploy receipt of this target.
        const live = liveOf(res, 'codeSha');
        if (!live.error) {
            scope.add('function-code-sha');
            const viaBaseline = !live.missing && sameValue('codeSha', b?.codeSha, live.value);
            const viaDeploy = !viaBaseline && deploy?.status === 'valid' && live.value === deploy.codeSha;
            code[fn] = viaBaseline ? 'baseline' : viaDeploy ? 'deploy-receipt' : 'different';
            entries.push({
                path: `functions/${fn}/codeSha`,
                axis: 'function-code-sha',
                equal: viaBaseline || viaDeploy,
                codeSource: code[fn],
            });
        }
        if (c.runtime)
            check('function-runtime-override', `functions/${fn}/runtime`, c.runtime, liveOf(res, 'runtime'), 'runtime');
        check('function-state(Active,Successful)', `functions/${fn}/state`, 'Active', liveOf(res, 'state'), 'state');
        check(
            'function-state(Active,Successful)',
            `functions/${fn}/lastUpdateStatus`,
            'Successful',
            liveOf(res, 'lastUpdateStatus'),
            'lastUpdateStatus',
        );
        const tags = liveOf(res, 'tags');
        check(
            'function-management-tag(deploy-managed)',
            `functions/${fn}/tags/deploy-managed`,
            'true',
            tags.error || tags.missing ? tags : { value: tags.value?.['deploy-managed'] },
            'tags',
        );
        // env values: compared in memory at inspect time; here only the stored categories.
        const e = res?.state === 'present' ? res.fields?.env : undefined;
        if (e?.state === 'no-backup' || res?.state !== 'present')
            notCompared.add('function-env-values (no backup or no function)');
        else if (e?.state !== 'error' && object(e?.value)) {
            scope.add('function-env-values(in memory vs env.json backup; KMS ciphertext excluded)');
            env[fn] = e.counts ?? {};
            for (const cat of ['changed', 'backupOnly', 'liveOnly'])
                for (const k of e.value[cat] ?? [])
                    entries.push({
                        path: `functions/${fn}/env/${k}`,
                        axis: 'function-env-values',
                        equal: false,
                        category: cat,
                    });
            if ((e.value.notComparable ?? []).length)
                notCompared.add('kms-encrypted-env-values (key names in the result file)');
        }
    }
    // a baseline function outside the two target functions is a difference (never silently dropped).
    for (const fn of Object.keys(sec('functions')).filter(n => !names.includes(n)))
        entries.push({
            path: `functions/${fn}`,
            axis: 'function-config(handler,memory,timeout)',
            equal: false,
            notObserved: true,
        });
    const tableProps = object(plan?.tableProps) ? plan.tableProps : {};
    for (const t of Object.keys(sec('tables'))) {
        const res = inv.tables?.[t],
            b = sec('tables')[t];
        const firstObservation = mode === 'first-observation';
        const axis = firstObservation
            ? 'table-identity(arn,id,created,keySchema,stream)'
            : 'table-identity(arn,created,keySchema,stream)';
        // a first-observation baseline holds the table id (the canonical snapshot does not).
        if (firstObservation) check(axis, `tables/${t}/id`, b?.id, liveOf(res, 'id'), 'id');
        check(
            axis,
            `tables/${t}/arn`,
            `arn:aws:dynamodb:${c.region}:${c.account}:table/${t}`,
            liveOf(res, 'arn'),
            'arn',
        );
        check(axis, `tables/${t}/created`, b?.created, liveOf(res, 'created'), 'created');
        check(axis, `tables/${t}/stream`, b?.stream, liveOf(res, 'stream'), 'stream');
        const keySchema = normalizeKeySchema(tableProps[t]?.KeySchema);
        if (keySchema) check(axis, `tables/${t}/keySchema`, keySchema, liveOf(res, 'keySchema'), 'keySchema');
        else notCompared.add('table-key-schema (not in plan.json)');
        const items = liveOf(res, 'items');
        approximate[`tables/${t}/items`] =
            items.error || items.missing ? 'unknown' : sameValue('items', b?.items, items.value) ? 'same' : 'different';
        owner(`tables/${t}`, res);
    }
    for (const q of Object.keys(sec('queues'))) {
        const res = inv.queues?.[q],
            b = sec('queues')[q];
        for (const f of ['url', 'created'])
            check('queue-identity(url,created)', `queues/${q}/${f}`, b?.[f], liveOf(res, f), f);
        const m = liveOf(res, 'messages');
        approximate[`queues/${q}/messages`] =
            m.error || m.missing ? 'unknown' : sameValue('messages', b?.messages, m.value) ? 'same' : 'different';
        owner(`queues/${q}`, res);
    }
    for (const arn of Object.keys(sec('topics'))) {
        const res = inv.topics?.[arn];
        check(
            'topic-subscription-count',
            pathOf('topics', arn, 'subscriptions'),
            sec('topics')[arn]?.subscriptions,
            liveOf(res, 'subscriptions'),
            'subscriptions',
        );
        owner(`topics/${arnName(arn)}`, res);
    }
    for (const bk of Object.keys(sec('buckets'))) {
        const res = inv.buckets?.[bk];
        for (const f of ['created', 'objects', 'website', 'policySids'])
            check(
                'bucket(created,objects,website,policySids)',
                `buckets/${bk}/${f}`,
                sec('buckets')[bk]?.[f],
                liveOf(res, f),
                f,
            );
        owner(`buckets/${bk}`, res);
    }
    for (const g of Object.keys(sec('logGroups'))) {
        const res = inv.logGroups?.[g];
        for (const f of ['created', 'retention'])
            check('log-group(created,retention)', `logGroups/${g}/${f}`, sec('logGroups')[g]?.[f], liveOf(res, f), f);
        owner(`logGroups/${g}`, res);
    }
    if (object(B?.api)) {
        for (const f of ['id', 'routes', 'stages'])
            check('rest-api(id,routes,stages)', `api/${f}`, B.api[f], liveOf(inv.api, f), f);
        owner('api', inv.api);
    }
    if (inv.httpProbes === 'on')
        for (const p of Object.keys(sec('http'))) {
            const r = inv.http?.[p];
            check(
                'http-status(public GET probes, app calls)',
                `http/${p}`,
                sec('http')[p],
                !object(r) ? { missing: true } : r.state === 'error' ? { error: true } : { value: r.value },
                'http',
            );
        }
    else if (Object.keys(sec('http')).length) notCompared.add('http-status (probes off)');
    if (!c.runtime) notCompared.add('function-runtime (no runtime override; the canonical verify excludes it)');
    for (const x of [
        'deploy-service-history-and-active-lease (deployId recorded only)',
        'event-delivery',
        'data-equality',
        'runtime-performance',
        'iam-role-and-policy',
        'event-source-mapping-settings (recorded only)',
        'sns-subscription-endpoints (recorded only)',
        'table-item-count (approximate reference only)',
        'queue-message-count (approximate)',
        ...(mode === 'run' ? ['table-id (no baseline value)'] : ['http-status (not probed in discover mode)']),
    ])
        notCompared.add(x);
    return { entries, approximate, code, env, cfOwned, scope: [...scope].sort(), notCompared: [...notCompared].sort() };
}

// the resolvable rule of a path: `ok`, or the reason (message) why it is never resolvable.
export function resolvableReason(p) {
    const { section, name, field } = splitPath(p);
    if (/(^|\/)env(Keys)?(\/|$)/.test(p) || field === 'envKeys')
        return 'Environment keys and values are never resolvable.';
    if (field === 'codeSha') return 'Code is never resolvable.';
    if (['url', 'stream', 'arn', 'roleArn', 'endpoints', 'policySids', 'id'].includes(field) || section === 'topics')
        return 'ARNs, URLs, identities and policies are never resolvable.';
    if (!name || !RESOLVABLE[section]?.includes(field))
        return 'Only non-secret scalar settings are resolvable: logGroups/<name>/retention, functions/<name>/memory, functions/<name>/timeout.';
    return 'ok';
}

// the observed value of a path in an inventory (`{ value }`, `{ error }` or `{ missing }`).
const inventoryValue = (inv, p) => {
    const { section, name, field } = splitPath(p);
    return liveOf(inv[section]?.[name], field);
};

// the JSON-safe form of a possibly unset value (`{ value }` or `{ unset: true }`).
const boxed = v => (v === undefined ? { unset: true } : { value: v });
// the value of a boxed form.
const unbox = b => (object(b) && !b.unset ? b.value : undefined);

/**
 * whether a resolution applies to the current run: it binds the same target, config, owner, receipt bytes,
 * snapshot hashes and before/after files, and accepts exactly the verify DIFF with the same from/to values.
 */
export function resolutionStatus(res, { c, target, state, diff }) {
    const p = res.payload;
    if (canonical(p.target) !== canonical(identityOf(target)) || p.configFingerprint !== fingerprint(c))
        return 'other-target';
    if (p.ownerId !== state.receipt.ownerId || p.receipt?.sha256 !== state.receiptSha256) return 'receipt-changed';
    if (canonical(p.receipt?.snapshots) !== canonical(state.receipt.snapshots ?? {})) return 'receipt-changed';
    if (
        p.before?.sha256 !== state.files['before.json']?.sha256 ||
        p.after?.sha256 !== state.files['after.json']?.sha256
    )
        return 'baseline-changed';
    const accepted = Array.isArray(p.accepted) ? p.accepted : [];
    if (
        !diff.length ||
        accepted.length !== diff.length ||
        diff.some(d => {
            const a = accepted.find(x => x?.path === d.path);
            return (
                !a ||
                !sameValue(splitPath(d.path).field, unbox(a.from), d.from) ||
                !sameValue(splitPath(d.path).field, unbox(a.to), d.to)
            );
        })
    )
        return 'diff-mismatch';
    return 'applied';
}

// the DIFF of the original verify, when the receipt stopped `unknown` at `verify` with an after snapshot; else [].
const unknownVerifyDiff = state => {
    const r = state.receipt;
    const verifyStopped =
        r.status === 'unknown' &&
        r.steps?.at?.(-1)?.phase === 'verify' &&
        canonical(r.completed) === canonical(PHASES.slice(0, -1));
    return verifyStopped && state.before && state.after ? verifyDiff(state.before, state.after) : null;
};

/** the pure reconcile decision (class, reasons, run state, entries); `now` is a Date. */
export function reconcileRun({ c, state, inventory, deploy, resolutions = [], now }) {
    const target = state.target;
    const inv = inventory.payload;
    const reasons = new Set();
    if (canonical(inv.target) !== canonical(identityOf(target)) || inv.configFingerprint !== fingerprint(c))
        reasons.add('target-mismatch');
    const started = Date.parse(inv.startedAt);
    if (!Number.isFinite(started) || now - started > STALE_AFTER_MS || started - now > FUTURE_SKEW_MS)
        reasons.add('inventory-stale');
    // the run state the inventory saw must still be the current one.
    if (inv.runReceipt?.sha256 !== state.receiptSha256) reasons.add('inventory-stale');
    if ((inv.envBackup?.sha256 ?? null) !== (state.files['env.json']?.sha256 ?? null)) reasons.add('inventory-stale');
    if (!state.baseline) reasons.add('no-baseline');
    else if (inv.baseline?.file !== state.baseline.file || inv.baseline?.sha256 !== state.baseline.sha256)
        reasons.add('inventory-stale');
    const binding = baselineBinding(state);
    if (binding.startsWith('changed') || ['plan.json', 'env.json'].some(n => bindingOf(state, n) === 'changed'))
        reasons.add('baseline-changed');
    if (inv.stack?.state === 'present') reasons.add('stack-present');
    else if (inv.stack?.state !== 'absent') reasons.add('read-error');
    const errors = inventoryErrors(inv);
    if (errors.length) reasons.add('read-error');
    if (errors.some(e => e.kind === 'target-mismatch')) reasons.add('target-mismatch');
    if (deploy?.status === 'other-target') reasons.add('target-mismatch');
    const cmp = compareInventory({
        c,
        target,
        inv,
        baseline: state.baseline?.value,
        plan: state.plan,
        deploy: deploy?.status === 'valid' ? deploy : undefined,
    });
    if (cmp.cfOwned.length) reasons.add('cf-owned-resource');
    // the run state: completed, an unknown verify whose DIFF is attested exactly, or unresolved.
    const diff = unknownVerifyDiff(state);
    const statuses = resolutions.map(r => ({
        rel: r.rel,
        sha256: r.sha256,
        status: resolutionStatus(r, { c, target, state, diff: diff ?? [] }),
    }));
    const covering = statuses.find(s => s.status === 'applied');
    const runState =
        state.receipt.status === 'completed'
            ? 'completed'
            : diff?.length && covering
            ? 'resolved-observed-diff'
            : 'unresolved';
    if (runState === 'unresolved') reasons.add('receipt-unknown-unresolved');
    const differing = cmp.entries.filter(e => !e.equal);
    const klass = reasons.size ? 'blocked' : differing.length ? 'reconcile-required' : 'verified-no-op';
    return {
        class: klass,
        reasons: REASONS.filter(r => reasons.has(r)),
        runState,
        binding,
        errors,
        cmp,
        differing,
        accepted: covering ? (diff ?? []).map(d => d.path) : [],
        resolutions: statuses,
    };
}

//* ---- commands ----

// the lemon-core version and, when it runs from its own Git checkout, its HEAD (else null).
export async function toolRevision({ exec = promisify(execFile) } = {}) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    let version = null,
        gitSha = null;
    try {
        version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version ?? null;
    } catch {}
    try {
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
        // one local `git` read of the lemon-core checkout.
        const git = async args =>
            (await exec('git', ['-C', root, ...args], { env, encoding: 'utf8', timeout: 5000 })).stdout.trim();
        // an installed copy under a service's node_modules must not report the service's HEAD.
        if ((await realpath(await git(['rev-parse', '--show-toplevel']))) === (await realpath(root))) {
            const head = await git(['rev-parse', 'HEAD']);
            if (/^[a-f0-9]{40}$/.test(head)) gitSha = head;
        }
    } catch {}
    return { name: 'lemon-core', version, gitSha };
}

// the read plan of `inspect` (API -> number of calls), from the baseline identities.
function readPlan(ids, httpProbe) {
    // one plan row, omitted when there is no call.
    const n = (api, calls) => (calls ? [{ api, calls }] : []);
    const retained =
        ids.tables.length +
        ids.queues.length +
        ids.topics.length +
        ids.buckets.length +
        ids.logGroups.length +
        (ids.api ? 1 : 0);
    return [
        { api: 'sts:GetCallerIdentity', calls: 1 },
        { api: 'cloudformation:DescribeStacks', calls: 1 },
        ...n('lambda:GetFunctionConfiguration', 2),
        ...n('lambda:ListTags', 2),
        ...n('lambda:ListEventSourceMappings', 2),
        ...n('dynamodb:DescribeTable', ids.tables.length),
        ...n('sqs:GetQueueUrl', ids.queues.length),
        ...n('sqs:GetQueueAttributes', ids.queues.length),
        ...n('sns:GetTopicAttributes', ids.topics.length),
        ...n('sns:ListSubscriptionsByTopic', ids.topics.length),
        ...n('s3:HeadBucket', ids.buckets.length),
        ...n('s3:ListBuckets (filtered to the bucket)', ids.buckets.length),
        ...n('s3:ListObjectsV2', ids.buckets.length),
        ...n('s3:GetBucketWebsite', ids.buckets.length),
        ...n('s3:GetBucketPolicy', ids.buckets.length),
        ...n('logs:DescribeLogGroups', ids.logGroups.length),
        ...n('apigateway:GetResources', ids.api ? 1 : 0),
        ...n('apigateway:GetStages', ids.api ? 1 : 0),
        ...n('cloudformation:DescribeStackResources (owner of each retained resource)', retained),
        ...(httpProbe ? n('https:GET (public probe, app call)', ids.api ? ids.http.length : 0) : []),
    ];
}

// `inspect` without `--execute`: what would be read and written; nothing is called.
function inspectPlan(c, state, ids, options) {
    return {
        schemaVersion: 1,
        command: 'inspect',
        execution: 'offline-plan',
        target: identityOf(state.target),
        runState: state.present ? 'owned' : 'absent',
        runReceipt: state.present ? state.receipt.status : null,
        baseline: state.baseline?.file ?? 'none',
        reads: readPlan(ids, options.httpProbe),
        httpProbes: options.httpProbe
            ? { mode: 'on', appCall: true, paths: ids.api ? ids.http.length : 0 }
            : { mode: 'off' },
        writes: [`${MIGRATION.runsDir}/${state.target.stack}/${RECORD_DIRS.inventory}/<UTC-stamp>.json (0600)`],
        requiredFlags: ['--execute'],
        limitations: [
            'No AWS call has run.',
            ...(state.present ? [] : ['--execute stops: no run state of this target (RUN_STATE_MISSING).']),
            'Read-only: STS identity and Describe/Get/List calls; HTTP probes only with --http-probe (app calls).',
            'Env values are compared in memory with env.json; only key names, categories and counts are stored.',
        ],
    };
}

// the stdout summary of an inventory (names, counts and status only).
function inspectSummary(inv, file) {
    const errors = inventoryErrors(inv);
    const states = { present: 0, absent: 0, error: 0 };
    // count the resource-level states of every observed resource.
    const count = rec => {
        if (object(rec) && rec.state in states) states[rec.state]++;
    };
    count(inv.stack);
    for (const s of ['functions', 'tables', 'queues', 'topics', 'buckets', 'logGroups'])
        Object.values(inv[s]).forEach(count);
    if (inv.api) count(inv.api);
    return {
        schemaVersion: 1,
        command: 'inspect',
        execution: 'read-only',
        ...(inv.mode === 'discover' ? { mode: 'discover' } : {}),
        status: inv.status ?? (errors.length ? 'observed-with-errors' : 'observed'),
        target: inv.target,
        baseline: inv.baseline?.file ?? 'none',
        runReceipt: inv.runReceipt?.status ?? 'none',
        lock: inv.lock,
        stack: { state: inv.stack.state, ...(inv.stack.status ? { status: inv.stack.status } : {}) },
        functions: Object.fromEntries(Object.entries(inv.functions).map(([k, v]) => [k, v.state])),
        resources: {
            tables: Object.keys(inv.tables).length,
            queues: Object.keys(inv.queues).length,
            topics: Object.keys(inv.topics).length,
            buckets: Object.keys(inv.buckets).length,
            logGroups: Object.keys(inv.logGroups).length,
            api: inv.api ? 1 : 0,
        },
        httpProbes:
            inv.httpProbes === 'on'
                ? { mode: 'on', appCall: true, count: Object.keys(inv.http).length }
                : { mode: 'off' },
        observations: states,
        errors: Object.fromEntries(errors.map(e => [e.path, e.kind])),
        ...(inv.mode === 'discover' ? { discovery: discoverySummary(inv.discovery) } : {}),
        inventory: file,
    };
}

// STS first, in the private child with the explicit profile (the check of every phase); a mismatch stops all reads.
async function confirmAccount(c, deps) {
    const sts = await (deps.runChild ?? runPrivateChild)({
        mode: 'sts',
        command: 'aws',
        args: [
            'sts',
            'get-caller-identity',
            '--profile',
            c.profile,
            '--region',
            c.region,
            '--output',
            'json',
            '--no-cli-pager',
        ],
        cwd: c.migrationRepo,
        environment: targetEnvironment(c, deps.environment ?? process.env),
        timeoutMs: Math.min(c.timeoutMs, 30000),
        signal: deps.signal,
    });
    if (sts.code !== 0 || sts.account !== c.account)
        fail('ACCOUNT_MISMATCH', 'STS account could not be confirmed for the configured profile.');
}

// the CloudFormation stack: `present` (with its status), `absent` only for the exact not-found error, else an error.
async function observeStack(read, c) {
    const r = await read('cloudformation:DescribeStacks', ['--stack-name', c.stack], {
        absent: [{ code: 'ValidationError', message: new RegExp(`Stack with id ${escapeRe(c.stack)} does not exist`) }],
    });
    const status = r.value?.Stacks?.[0]?.StackStatus;
    if (r.state !== 'value') return { name: c.stack, ...resourceOf(r) };
    if (typeof status !== 'string') return { name: c.stack, ...errorOf(r, 'other') };
    return { name: c.stack, state: 'present', status, sourceApi: r.sourceApi, observedAt: r.observedAt };
}

// `inspect`: offline plan, or (with `--execute`) the STS check and the read-only inventory.
async function commandInspect(c, options, deps) {
    //* v5 B27-b: `--discover` is the first observation of a target without run state.
    if (options.discover) return commandDiscover(c, options, deps);
    const state = await readRunState(c, { requireRun: Boolean(options.execute) });
    const ids = baselineIdentities(state.baseline?.value, c);
    if (!options.execute) return { output: inspectPlan(c, state, ids, options), exitCode: 0 };
    if (process.platform === 'win32') fail('UNSUPPORTED_PLATFORM', 'Execution requires macOS/Linux.');
    rejectPlaceholders(c);
    const backup = envBackupOf(state);
    const now = deps.now ?? (() => new Date());
    const startedAt = iso(now());
    const deadline = Date.now() + c.timeoutMs;
    await confirmAccount(c, deps);
    const read = awsReader(c, { exec: deps.exec, environment: deps.environment, now, deadline, signal: deps.signal });
    const stack = await observeStack(read, c);
    const functions = {};
    for (const fn of functionNames(state.target)) functions[fn] = await observeFunction(read, c, fn, backup?.[fn]);
    // observe every identity of one baseline section, in order.
    const observeAll = async (keys, fn) => {
        const out = {};
        for (const k of keys) out[k] = await fn(read, c, k);
        return out;
    };
    const inventory = {
        schemaVersion: 1,
        kind: KINDS.inventory,
        execution: 'read-only',
        tool: await (deps.toolRevision ?? toolRevision)(),
        target: identityOf(state.target),
        configFingerprint: fingerprint(c),
        startedAt,
        runReceipt: { file: state.target.receiptFile, status: state.receipt.status, sha256: state.receiptSha256 },
        lock: state.lockPresent ? 'present' : 'absent',
        baseline: state.baseline ? { file: state.baseline.file, sha256: state.baseline.sha256 } : null,
        envBackup: state.files['env.json'] ? { file: 'env.json', sha256: state.files['env.json'].sha256 } : null,
        httpProbes: options.httpProbe ? 'on' : 'off',
        stack,
        functions,
        tables: await observeAll(ids.tables, observeTable),
        queues: await observeAll(ids.queues, observeQueue),
        topics: await observeAll(ids.topics, observeTopic),
        buckets: await observeAll(ids.buckets, observeBucket),
        logGroups: await observeAll(ids.logGroups, observeLogGroup),
        api: ids.api ? await observeApi(read, c, ids.api) : null,
        http:
            options.httpProbe && ids.api
                ? await probeHttp(c, ids.api, ids.http, { fetch: deps.fetch, now, signal: deps.signal })
                : {},
    };
    inventory.finishedAt = iso(now());
    const file = await writeRecord(
        state.run,
        RECORD_DIRS.inventory,
        `${stampOf(new Date(startedAt))}.json`,
        inventory,
        deps.onControlWrite,
    );
    return { output: inspectSummary(inventory, file), exitCode: inventoryErrors(inventory).length ? 3 : 0 };
}

// `reconcile`: offline comparison of an inventory with the run baseline; writes the result next to the inventory.
async function commandReconcile(c, options, deps) {
    //* v5 B27-b: no run state but an adopted first-observation baseline -> compare with that baseline.
    const observed = await observedState(c);
    if (!observed.runPresent && observed.baselinePresent) return reconcileObserved(c, options, deps, observed);
    const state = await readRunState(c);
    const now = (deps.now ?? (() => new Date()))();
    const inventory = await readRecord(
        state.run,
        RECORD_DIRS.inventory,
        options.inventoryFile,
        KINDS.inventory,
        'INVENTORY_INVALID',
    );
    const deploy = options.deployReceiptFile ? await readDeployReceipt(options.deployReceiptFile, c) : null;
    const resolutions = [];
    for (const f of options.resolutionFiles ?? [])
        resolutions.push(
            await readRecord(state.run, RECORD_DIRS.resolution, f, KINDS.resolution, 'RESOLUTION_INVALID'),
        );
    const r = reconcileRun({ c, state, inventory, deploy, resolutions, now });
    const counts = {
        compared: r.cmp.entries.length,
        equal: r.cmp.entries.filter(e => e.equal).length,
        differing: r.differing.length,
        accepted: r.accepted.length,
        readErrors: r.errors.length,
    };
    const record = {
        schemaVersion: 1,
        kind: KINDS.reconcile,
        execution: 'offline',
        tool: await (deps.toolRevision ?? toolRevision)(),
        target: identityOf(state.target),
        configFingerprint: fingerprint(c),
        createdAt: iso(now),
        class: r.class,
        reasons: r.reasons,
        runReceipt: {
            file: state.target.receiptFile,
            status: state.receipt.status,
            sha256: state.receiptSha256,
            ownerId: state.receipt.ownerId,
            runState: r.runState,
            // no phase resumes an unknown run: `resolved-observed-diff` is terminal for the six phases.
            resumable: state.receipt.status === 'ready',
            lock: state.lockPresent ? 'present' : 'absent',
        },
        inventory: { file: inventory.rel, sha256: inventory.sha256, startedAt: inventory.payload.startedAt },
        baseline: state.baseline
            ? { file: state.baseline.file, sha256: state.baseline.sha256, binding: r.binding }
            : null,
        snapshots: Object.fromEntries(
            Object.entries(state.files).map(([k, v]) => [k, { sha256: v.sha256, binding: bindingOf(state, k) }]),
        ),
        deployReceipt: deploy
            ? {
                  status: deploy.status,
                  ...(deploy.status === 'valid'
                      ? { sha256: deploy.sha256, deployId: deploy.deployId, mode: deploy.mode }
                      : {}),
              }
            : null,
        resolutions: r.resolutions,
        counts,
        // private file: expected/observed values of the differing fields (never env values: those are not stored).
        differing: r.differing.map(e => ({
            path: e.path,
            axis: e.axis,
            ...(e.category ? { category: e.category } : {}),
            ...(e.codeSource ? { codeSource: e.codeSource } : {}),
            ...(e.notObserved ? { notObserved: true } : {}),
            ...(Object.hasOwn(e, 'expected') && !e.notObserved
                ? { expected: boxed(e.expected), observed: boxed(e.observed) }
                : {}),
        })),
        accepted: r.accepted,
        readErrors: r.errors,
        cfOwned: r.cmp.cfOwned,
        approximate: r.cmp.approximate,
        code: r.cmp.code,
        env: r.cmp.env,
        envNotComparable: Object.fromEntries(
            Object.entries(inventory.payload.functions ?? {}).map(([k, v]) => [
                k,
                v?.fields?.env?.value?.notComparable ?? [],
            ]),
        ),
        scope: r.cmp.scope,
        notCompared: r.cmp.notCompared,
    };
    const stem = path.basename(inventory.file, '.json');
    const file = await writeRecord(
        state.run,
        RECORD_DIRS.inventory,
        `${stem}.reconcile-${stampOf(now)}.json`,
        record,
        deps.onControlWrite,
    );
    const output = {
        schemaVersion: 1,
        command: 'reconcile',
        execution: 'offline',
        class: r.class,
        reasons: r.reasons,
        target: record.target,
        runReceipt: {
            status: state.receipt.status,
            runState: r.runState,
            resumable: record.runReceipt.resumable,
            lock: record.runReceipt.lock,
        },
        baseline: { file: state.baseline?.file ?? 'none', binding: r.binding },
        counts,
        differing: r.differing.map(e => e.path),
        accepted: r.accepted,
        readErrors: r.errors.map(e => e.path),
        cfOwned: r.cmp.cfOwned,
        approximate: r.cmp.approximate,
        code: r.cmp.code,
        env: r.cmp.env,
        deployReceipt: deploy ? deploy.status : 'not-given',
        resolutions: { given: r.resolutions.length, applied: r.resolutions.filter(s => s.status === 'applied').length },
        scope: r.cmp.scope,
        notCompared: r.cmp.notCompared,
        result: file,
    };
    return { output, exitCode: r.class === 'verified-no-op' ? 0 : 3 };
}

// one `--accept <path>=<from>-><to>` (a value is a non-negative integer or `none` for unset).
export function parseAccept(text) {
    const eq = text.indexOf('=');
    const arrow = text.indexOf('->', eq + 1);
    const p = text.slice(0, eq),
        from = text.slice(eq + 1, arrow),
        to = text.slice(arrow + 2);
    const token = /^(none|\d{1,9})$/;
    if (eq < 1 || arrow < 0 || to.includes('->') || !token.test(from) || !token.test(to))
        fail('INVALID_ARGS', '--accept must be <path>=<from>-><to> with integers or none.');
    // a token as a value (`none` = unset).
    const value = t => (t === 'none' ? undefined : Number(t));
    return { path: p, from: value(from), to: value(to) };
}

// `resolve`: a local attestation of an owner decision on the setting DIFF of an unknown verify (no AWS, no mutation).
async function commandResolve(c, options, deps) {
    const state = await readRunState(c);
    const now = (deps.now ?? (() => new Date()))();
    const inventory = await readRecord(
        state.run,
        RECORD_DIRS.inventory,
        options.inventoryFile,
        KINDS.inventory,
        'INVENTORY_INVALID',
    );
    const inv = inventory.payload;
    if (canonical(inv.target) !== canonical(identityOf(state.target)) || inv.configFingerprint !== fingerprint(c))
        fail('TARGET_MISMATCH', 'The inventory belongs to another target or config.');
    const started = Date.parse(inv.startedAt);
    if (
        !Number.isFinite(started) ||
        now - started > STALE_AFTER_MS ||
        started - now > FUTURE_SKEW_MS ||
        inv.runReceipt?.sha256 !== state.receiptSha256 ||
        inv.baseline?.sha256 !== state.baseline?.sha256
    )
        fail(
            'INVENTORY_STALE',
            'The inventory is older than 1 h or the run state changed; run inspect --execute again.',
        );
    const diff = unknownVerifyDiff(state);
    if (!diff)
        fail(
            'RESOLUTION_REFUSED',
            'Only an unknown verify outcome (receipt unknown at verify, after.json present) is resolvable.',
        );
    if (!diff.length)
        fail(
            'RESOLUTION_REFUSED',
            'The original verify has no setting difference; an unknown outcome is not resolvable by attestation.',
        );
    // the plan-time snapshots must still be the ones the receipt recorded (after.json is unbound at an unknown verify).
    if (['plan.json', 'env.json', 'before.json'].some(n => bindingOf(state, n) !== 'bound'))
        fail('RESOLUTION_REFUSED', 'The run snapshots differ from the hashes recorded in the receipt.');
    const accepts = options.accepts.map(parseAccept);
    for (const a of accepts) {
        const why = resolvableReason(a.path);
        if (why !== 'ok') fail('RESOLUTION_REFUSED', `${a.path}: ${why}`);
    }
    if (new Set(accepts.map(a => a.path)).size !== accepts.length) fail('INVALID_ARGS', 'Duplicate --accept path.');
    for (const d of diff)
        if (resolvableReason(d.path) !== 'ok')
            fail(
                'RESOLUTION_REFUSED',
                `The original verify DIFF ${d.path} is not a non-secret scalar setting; it is not resolvable here.`,
            );
    const wanted = diff.map(d => d.path).sort();
    if (canonical(accepts.map(a => a.path).sort()) !== canonical(wanted))
        fail(
            'RESOLUTION_REFUSED',
            `The accepted paths must equal the DIFF set of the original verify: ${wanted.join(', ')}.`,
        );
    for (const d of diff) {
        const a = accepts.find(x => x.path === d.path);
        const field = splitPath(d.path).field;
        if (!sameValue(field, a.from, d.from) || !sameValue(field, a.to, d.to))
            fail(
                'RESOLUTION_REFUSED',
                `The from/to values of ${d.path} do not match the original verify (before -> after).`,
            );
        const live = inventoryValue(inv, d.path);
        if (live.error || live.missing || !sameValue(field, live.value, d.to))
            fail(
                'RESOLUTION_REFUSED',
                `The inventory value of ${d.path} is not the verify after-value; run reconcile.`,
            );
    }
    const reason = options.reason;
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason))
        fail('INVALID_ARGS', '--reason must be 1-500 printable characters.');
    const r = state.receipt;
    const payload = {
        schemaVersion: 1,
        kind: KINDS.resolution,
        scope: 'local-owner-decision',
        authorizesMutation: false,
        note: 'Local attestation of an owner decision on the setting DIFF of an unknown verify. It is not the server-side approval receipt of the migration plan (T4), authorizes no write, never changes the receipt or removes the lock.',
        target: identityOf(state.target),
        configFingerprint: fingerprint(c),
        ownerId: r.ownerId,
        receipt: {
            file: state.target.receiptFile,
            sha256: state.receiptSha256,
            status: r.status,
            snapshots: r.snapshots ?? {},
        },
        before: {
            file: 'before.json',
            sha256: state.files['before.json'].sha256,
            binding: bindingLabel(state, 'before.json'),
        },
        after: {
            file: 'after.json',
            sha256: state.files['after.json'].sha256,
            binding: bindingLabel(state, 'after.json'),
        },
        inventory: { file: inventory.rel, sha256: inventory.sha256, startedAt: inv.startedAt },
        accepted: diff.map(d => ({ path: d.path, from: boxed(d.from), to: boxed(d.to) })),
        reason,
        tool: await (deps.toolRevision ?? toolRevision)(),
        createdAt: iso(now),
    };
    const file = await writeRecord(
        state.run,
        RECORD_DIRS.resolution,
        `${stampOf(now)}.json`,
        payload,
        deps.onControlWrite,
    );
    return {
        output: {
            schemaVersion: 1,
            command: 'resolve',
            status: 'recorded',
            kind: KINDS.resolution,
            authorizesMutation: false,
            target: payload.target,
            runReceipt: { status: r.status, lock: state.lockPresent ? 'present' : 'absent' },
            accepted: payload.accepted.map(a => a.path),
            count: payload.accepted.length,
            resolution: file,
        },
        exitCode: 0,
    };
}

//* ---- v5 B27-b: first-observation baseline (a migrated target without run state in this checkout) ----

// what a first-observation baseline never proves (recorded in the baseline and in every result).
export const NOT_PROVEN = Object.freeze([
    'equality-with-migration-time-state',
    'data-equality',
    'event-delivery',
    'deploy-service-history',
]);

// the stage words a resource name is matched against (with the config stage); see `stageOf`.
export const STAGE_WORDS = Object.freeze([
    'local',
    'dev',
    'develop',
    'test',
    'qa',
    'stage',
    'staging',
    'prod',
    'production',
]);

// the resource types `tag:GetResources` is asked for (the kept types of the canonical `tag` phase, and functions).
export const TAG_TYPES = Object.freeze([
    'dynamodb:table',
    'sqs',
    'sns',
    's3',
    'logs:log-group',
    'apigateway',
    'lambda:function',
]);

// the `deploy-project` tag value of the canonical `tag` phase: the project without its `-api` suffix.
export const projectTag = c => c.project.replace(/-api$/, '');

/**
 * the stage a resource name carries: the one stage word among its segments (split on non-alphanumerics; the
 * segments of the project name are ignored). `null` when there is none, `'multiple'` when there are several.
 */
export function stageOf(name, c) {
    // the lower-case alphanumeric segments of a name.
    const segments = n =>
        `${n ?? ''}`
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
    const project = new Set(segments(c.project));
    const words = new Set([...STAGE_WORDS, c.stage.toLowerCase()]);
    const found = new Set(segments(name).filter(t => !project.has(t) && words.has(t)));
    return found.size === 1 ? [...found][0] : found.size ? 'multiple' : null;
}

/** a tagged ARN of this account/region as `{ type, key, name }` (`key` as the inventory sections use it). */
export function taggedResource(arn, c) {
    const ra = `${escapeRe(c.region)}:${escapeRe(c.account)}`;
    // the first rule that matches the ARN.
    const rules = [
        ['table', new RegExp(`^arn:aws:dynamodb:${ra}:table/([^/]+)$`), m => [m[1], m[1]]],
        ['queue', new RegExp(`^arn:aws:sqs:${ra}:([^:/]+)$`), m => [m[1], m[1]]],
        ['topic', new RegExp(`^arn:aws:sns:${ra}:([^:/]+)$`), m => [arn, m[1]]],
        ['bucket', /^arn:aws:s3:::([^/]+)$/, m => [m[1], m[1]]],
        ['logGroup', new RegExp(`^arn:aws:logs:${ra}:log-group:(.+?)(:\\*)?$`), m => [m[1], m[1]]],
        [
            'api',
            new RegExp(`^arn:aws:apigateway:${escapeRe(c.region)}::/restapis/([a-z0-9]{1,32})$`),
            m => [m[1], m[1]],
        ],
        [
            'apiStage',
            new RegExp(`^arn:aws:apigateway:${escapeRe(c.region)}::/restapis/([a-z0-9]{1,32})/stages/([^/]+)$`),
            m => [m[1], m[2]],
        ],
        ['function', new RegExp(`^arn:aws:lambda:${ra}:function:([^:]+)$`), m => [m[1], m[1]]],
        ['esm', new RegExp(`^arn:aws:lambda:${ra}:event-source-mapping:([A-Za-z0-9-]+)$`), m => [m[1], m[1]]],
    ];
    for (const [type, re, pick] of rules) {
        const m = typeof arn === 'string' ? re.exec(arn) : null;
        if (m) {
            const [key, name] = pick(m);
            return { type, key, name };
        }
    }
    return { type: 'other', key: `${arn}`, name: arnName(arn) };
}

// the inventory section of a tagged type (`null` for types that are not observed as retained resources).
const SECTION_OF = Object.freeze({
    table: 'tables',
    queue: 'queues',
    topic: 'topics',
    bucket: 'buckets',
    logGroup: 'logGroups',
});

// the table of a DynamoDB stream ARN in this account/region (else null).
const streamTable = (arn, c) =>
    new RegExp(`^arn:aws:dynamodb:${escapeRe(c.region)}:${escapeRe(c.account)}:table/([^/]+)/stream/`).exec(
        `${arn}`,
    )?.[1] ?? null;
// the queue of an SQS ARN in this account/region (else null).
const queueOf = (arn, c) =>
    new RegExp(`^arn:aws:sqs:${escapeRe(c.region)}:${escapeRe(c.account)}:([^:/]+)$`).exec(`${arn}`)?.[1] ?? null;
// a topic ARN of this account/region.
const isTopicArn = (arn, c) => ID_RULES(c).topics.test(`${arn}`);

/**
 * discover the retained resources of a target without run state, from five sources (each recorded):
 * the two functions (observed before), their event source mappings, SNS subscriptions to them, their log groups,
 * and the resources the canonical `tag` phase tagged (`deploy-managed=true`, `deploy-project=<project w/o -api>`).
 * - a tagged resource is attributed to a stage by its name (`stageOf`), cross-checked with the function-derived
 *   resources. Another stage is excluded; no stage, several stages, or a conflict is `ambiguous` (never guessed).
 */
export async function discover(read, c, target, functions) {
    const ours = c.stage.toLowerCase();
    const names = functionNames(target);
    const fnArns = names.map(n => `arn:aws:lambda:${c.region}:${c.account}:function:${n}`);
    const found = { tables: new Map(), queues: new Map(), topics: new Map(), buckets: new Map(), logGroups: new Map() };
    const apis = new Map();
    // record one discovery source of a resource key.
    const add = (map, key, by) => {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(by);
    };
    const sources = {},
        ambiguous = [],
        excluded = [],
        otherTagged = [],
        external = [];
    // 1. the event source mappings of the two functions (observed with the functions).
    const ownEsm = new Set();
    for (const fn of names)
        for (const m of functions[fn]?.fields?.eventSourceMappings?.value ?? []) {
            ownEsm.add(m.uuid);
            const table = streamTable(m.sourceArn, c),
                queue = queueOf(m.sourceArn, c);
            if (table && ID_RULES(c).tables.test(table)) add(found.tables, table, 'event-source-mapping');
            else if (queue && ID_RULES(c).queues.test(queue)) add(found.queues, queue, 'event-source-mapping');
            else external.push({ source: 'event-source-mapping', name: arnName(m.sourceArn) });
        }
    // 2. SNS subscriptions whose endpoint is one of the two functions (the account list, filtered by the CLI).
    const query = `Subscriptions[?${fnArns.map(a => `Endpoint=='${a}'`).join(' || ')}]`;
    const subs = await read('sns:ListSubscriptions', ['--query', query]);
    if (subs.state === 'value') {
        const own = (Array.isArray(subs.value) ? subs.value : []).filter(
            x => x?.Protocol === 'lambda' && fnArns.includes(x?.Endpoint),
        );
        sources.snsSubscriptions = fieldOf(subs, own.length);
        for (const x of own)
            if (isTopicArn(x.TopicArn, c)) add(found.topics, x.TopicArn, 'sns-subscription');
            else external.push({ source: 'sns-subscription', name: arnName(x.TopicArn) });
    } else sources.snsSubscriptions = errorOf(subs);
    // 3. the log groups of the two functions (read by the log group observation below).
    for (const fn of names) add(found.logGroups, `/aws/lambda/${fn}`, 'log-group-prefix');
    // 4. the resources tagged by the canonical `tag` phase for this project (any stage).
    const tag = projectTag(c);
    const tagged = await read('tag:GetResources', [
        '--tag-filters',
        'Key=deploy-managed,Values=true',
        `Key=deploy-project,Values=${tag}`,
        '--resource-type-filters',
        ...TAG_TYPES,
    ]);
    const stageApis = [];
    if (tagged.state !== 'value') sources.tagged = errorOf(tagged);
    else {
        const list = (
            Array.isArray(tagged.value?.ResourceTagMappingList) ? tagged.value.ResourceTagMappingList : []
        ).filter(x => {
            const t = Object.fromEntries((x?.Tags ?? []).map(k => [k?.Key, k?.Value]));
            return t['deploy-managed'] === 'true' && t['deploy-project'] === tag;
        });
        sources.tagged = fieldOf(tagged, list.length);
        for (const item of list) {
            const r = taggedResource(item.ResourceARN, c);
            let stage;
            if (r.type === 'api') {
                // the REST API name carries the stage (`dev-<service>` by default).
                const g = await read('apigateway:GetRestApi', ['--rest-api-id', r.key]);
                if (g.state !== 'value') {
                    sources[`restApi/${r.key}`] = errorOf(g);
                    continue;
                }
                r.name = typeof g.value?.name === 'string' ? g.value.name : r.key;
                stage = stageOf(r.name, c);
            } else if (r.type === 'esm' && !ownEsm.has(r.key)) {
                // a mapping of another function: attributed by that function's name.
                const g = await read('lambda:GetEventSourceMapping', ['--uuid', r.key]);
                if (g.state !== 'value') {
                    sources[`eventSourceMapping/${r.key}`] = errorOf(g);
                    continue;
                }
                stage = stageOf(arnName(g.value?.FunctionArn), c);
            } else stage = r.type === 'esm' ? ours : stageOf(r.name, c);
            const section = SECTION_OF[r.type];
            // a resource wired to the two functions is ours unless its name says another stage (a conflict).
            if (section && found[section].has(r.key)) {
                if (stage === ours || stage === null) add(found[section], r.key, 'tag');
                else ambiguous.push({ type: r.type, name: r.name, why: 'conflicts-with-function-wiring' });
                continue;
            }
            if (stage === null || stage === 'multiple') {
                ambiguous.push({ type: r.type, name: r.name, why: stage ? 'several-stages' : 'no-stage' });
                continue;
            }
            if (stage !== ours) {
                excluded.push({ type: r.type, name: r.name, stage });
                continue;
            }
            if (section) add(found[section], r.key, 'tag');
            else if (r.type === 'api') add(apis, r.key, 'tag');
            else if (r.type === 'apiStage') stageApis.push(r.key);
            else if (r.type === 'function' && !names.includes(r.key))
                ambiguous.push({ type: r.type, name: r.name, why: 'unexpected-function' });
            else if (!['function', 'esm'].includes(r.type)) otherTagged.push({ type: r.type, name: r.name });
        }
    }
    // one REST API per stage; a tagged stage of this stage must belong to it.
    if (apis.size > 1) for (const id of apis.keys()) ambiguous.push({ type: 'api', name: id, why: 'several-apis' });
    for (const id of stageApis)
        if (!apis.has(id) || apis.size > 1) ambiguous.push({ type: 'apiStage', name: id, why: 'stage-of-another-api' });
    // a discovery map as a sorted object of sorted source lists.
    const asObject = map =>
        Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, [...v].sort()]));
    return {
        found: Object.fromEntries(Object.entries(found).map(([k, m]) => [k, asObject(m)])),
        api: apis.size === 1 ? [...apis.keys()][0] : null,
        record: {
            projectTag: tag,
            stage: c.stage,
            stageWords: STAGE_WORDS,
            resourceTypes: TAG_TYPES,
            sources,
            excluded,
            ambiguous,
            otherTagged,
            external,
            reasons: ambiguous.length ? ['ambiguous-discovery'] : [],
        },
    };
}

// the stdout part of a discovery record: counts, the excluded stages and the ambiguous names only.
function discoverySummary(d) {
    const excluded = {};
    for (const x of d?.excluded ?? []) excluded[x.stage] = (excluded[x.stage] ?? 0) + 1;
    return {
        projectTag: d?.projectTag,
        reasons: d?.reasons ?? [],
        excluded,
        ambiguous: (d?.ambiguous ?? []).map(x => `${x.type} ${x.name} (${x.why})`),
        otherTagged: (d?.otherTagged ?? []).length,
        external: (d?.external ?? []).length,
    };
}

/** the state of a target without run state: the run dir flag and the private `<runsDir>/<stack>.observed` dir. */
export async function observedState(c, { create = false } = {}) {
    const target = migrationTarget(c);
    const runRel = `${MIGRATION.runsDir}/${target.stack}`;
    const rel = `${runRel}.observed`;
    const run = path.join(c.migrationRepo, runRel),
        dir = path.join(c.migrationRepo, rel);
    await noSymlinkChain(c.migrationRepo, rel);
    const runPresent = Boolean(await lstat(run).catch(() => null));
    let present = Boolean(await lstat(dir).catch(() => null));
    // created only to write a record; the run dir itself is never created here.
    if (!present && create) {
        await mkdir(path.dirname(dir), { recursive: true, mode: 0o700 });
        await mkdir(dir, { mode: 0o700 });
        await chmod(dir, 0o700);
        present = true;
    }
    if (present) await privateEntry(dir, 'dir');
    const baselineFile = path.join(dir, 'baseline.json');
    const baselinePresent = present && Boolean(await lstat(baselineFile).catch(() => null));
    return { target, run, runPresent, dir, rel, present, baselineFile, baselinePresent };
}

// `inspect --discover` without `--execute`: the discovery reads; nothing is called.
function discoverPlan(c, os) {
    return {
        schemaVersion: 1,
        command: 'inspect',
        mode: 'discover',
        execution: 'offline-plan',
        target: identityOf(os.target),
        runState: 'absent',
        baseline: os.baselinePresent ? 'first-observation' : 'none',
        projectTag: projectTag(c),
        reads: [
            { api: 'sts:GetCallerIdentity', calls: 1 },
            { api: 'cloudformation:DescribeStacks', calls: 1 },
            { api: 'lambda:GetFunctionConfiguration', calls: 2 },
            { api: 'lambda:ListTags', calls: 2 },
            { api: 'lambda:ListEventSourceMappings', calls: 2 },
            { api: 'sns:ListSubscriptions (filtered to the two functions)', calls: 1 },
            { api: 'tag:GetResources (deploy-managed=true, deploy-project)', calls: 1 },
            { api: 'apigateway:GetRestApi (per tagged REST API)', calls: 'per tagged API' },
            { api: 'lambda:GetEventSourceMapping (per tagged mapping of another function)', calls: 'per mapping' },
            { api: 'the per-resource reads of inspect, for every discovered resource', calls: 'per resource' },
        ],
        httpProbes: { mode: 'off' },
        writes: [`${os.rel}/${RECORD_DIRS.inventory}/<UTC-stamp>.json (0600)`],
        requiredFlags: ['--execute'],
        limitations: [
            'No AWS call has run.',
            `Never creates ${MIGRATION.runsDir}/${os.target.stack}/ (a later plan phase starts as before).`,
            'A tagged resource without exactly one stage word in its name, or conflicting with the function wiring, blocks the inventory (ambiguous-discovery).',
            'No env backup exists: env key names only.',
        ],
    };
}

// `inspect --execute --discover`: STS, the five discovery sources, the per-resource reads; a private inventory.
async function commandDiscover(c, options, deps) {
    const os = await observedState(c);
    if (os.runPresent) fail('RUN_STATE_PRESENT', 'This target has run state; use inspect without --discover.');
    if (!options.execute) return { output: discoverPlan(c, os), exitCode: 0 };
    if (process.platform === 'win32') fail('UNSUPPORTED_PLATFORM', 'Execution requires macOS/Linux.');
    rejectPlaceholders(c);
    const now = deps.now ?? (() => new Date());
    const startedAt = iso(now());
    const deadline = Date.now() + c.timeoutMs;
    await confirmAccount(c, deps);
    const read = awsReader(c, { exec: deps.exec, environment: deps.environment, now, deadline, signal: deps.signal });
    const stack = await observeStack(read, c);
    const functions = {};
    for (const fn of functionNames(os.target)) functions[fn] = await observeFunction(read, c, fn, undefined);
    const d = await discover(read, c, os.target, functions);
    // observe one discovered section with the per-resource reads of inspect, keeping its discovery sources.
    const observeAll = async (section, fn) => {
        const out = {};
        for (const [k, by] of Object.entries(d.found[section]))
            out[k] = { ...(await fn(read, c, k)), discoveredBy: by };
        return out;
    };
    const inventory = {
        schemaVersion: 1,
        kind: KINDS.inventory,
        mode: 'discover',
        execution: 'read-only',
        tool: await (deps.toolRevision ?? toolRevision)(),
        target: identityOf(os.target),
        configFingerprint: fingerprint(c),
        startedAt,
        runReceipt: null,
        lock: 'none',
        baseline: null,
        envBackup: null,
        httpProbes: 'off',
        stack,
        functions,
        discovery: d.record,
        tables: await observeAll('tables', observeTable),
        queues: await observeAll('queues', observeQueue),
        topics: await observeAll('topics', observeTopic),
        buckets: await observeAll('buckets', observeBucket),
        logGroups: await observeAll('logGroups', observeLogGroup),
        api: d.api ? { ...(await observeApi(read, c, d.api)), discoveredBy: ['tag'] } : null,
        http: {},
    };
    inventory.finishedAt = iso(now());
    const errors = inventoryErrors(inventory);
    inventory.status = d.record.reasons.length ? 'blocked' : errors.length ? 'observed-with-errors' : 'observed';
    const dir = (await observedState(c, { create: true })).dir;
    const file = await writeRecord(
        dir,
        RECORD_DIRS.inventory,
        `${stampOf(new Date(startedAt))}.json`,
        inventory,
        deps.onControlWrite,
    );
    return { output: inspectSummary(inventory, file), exitCode: inventory.status === 'observed' ? 0 : 3 };
}

/** why a discover inventory cannot become the first-observation baseline (a message with names only), else null. */
export function adoptionRefusal(inv, c, target, now) {
    if (inv.mode !== 'discover') return 'Only an inventory of inspect --execute --discover can be adopted.';
    if (canonical(inv.target) !== canonical(identityOf(target)) || inv.configFingerprint !== fingerprint(c))
        return 'The inventory belongs to another target or config.';
    const started = Date.parse(inv.startedAt);
    if (!Number.isFinite(started) || now - started > STALE_AFTER_MS || started - now > FUTURE_SKEW_MS)
        return 'The inventory is older than 1 h; run inspect --execute --discover again.';
    if ((inv.discovery?.reasons ?? []).length) return 'The discovery is ambiguous (ambiguous-discovery).';
    if (inv.status !== 'observed' || inventoryErrors(inv).length) return 'The inventory has read errors.';
    if (inv.stack?.state !== 'absent') return 'The CloudFormation stack is not absent.';
    for (const fn of functionNames(target)) {
        const f = inv.functions?.[fn];
        if (f?.state !== 'present') return `Function ${fn} is not present.`;
        if (f.fields?.state?.value !== 'Active' || f.fields?.lastUpdateStatus?.value !== 'Successful')
            return `Function ${fn} is not Active/Successful.`;
        if (f.fields?.tags?.value?.['deploy-managed'] !== 'true')
            return `Function ${fn} does not carry deploy-managed=true.`;
    }
    return null;
}

// `adopt-baseline`: the first observation becomes the baseline (append-only `baseline.json`, a local attestation).
async function commandAdopt(c, options, deps) {
    const os = await observedState(c);
    if (os.runPresent)
        fail(
            'RUN_STATE_PRESENT',
            'This target has run state; a first-observation baseline is only for a target without one.',
        );
    if (!os.present) fail('RUN_STATE_MISSING', 'No discover inventory exists; run inspect --execute --discover first.');
    if (os.baselinePresent)
        fail('BASELINE_EXISTS', 'A first-observation baseline exists already; it is never replaced.');
    const now = (deps.now ?? (() => new Date()))();
    const inventory = await readRecord(
        os.dir,
        RECORD_DIRS.inventory,
        options.inventoryFile,
        KINDS.inventory,
        'INVENTORY_INVALID',
    );
    const why = adoptionRefusal(inventory.payload, c, os.target, now);
    if (why) fail('ADOPTION_REFUSED', why);
    const reason = options.reason;
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason))
        fail('INVALID_ARGS', '--reason must be 1-500 printable characters.');
    const payload = {
        schemaVersion: 1,
        kind: KINDS.baseline,
        provenance: 'first-observation',
        authorizesMutation: false,
        notProven: NOT_PROVEN,
        note: 'Local attestation: the owner adopts this first observation as the baseline of a migrated target without run state. It authorizes no write and proves nothing about the state at migration time.',
        target: identityOf(os.target),
        configFingerprint: fingerprint(c),
        inventory: { file: inventory.rel, sha256: inventory.sha256, startedAt: inventory.payload.startedAt },
        reason,
        tool: await (deps.toolRevision ?? toolRevision)(),
        createdAt: iso(now),
    };
    let file;
    try {
        file = await writeRecord(os.dir, '', 'baseline.json', payload, deps.onControlWrite);
    } catch (error) {
        if (error?.code === 'RECORD_EXISTS')
            fail('BASELINE_EXISTS', 'A first-observation baseline exists already; it is never replaced.');
        throw error;
    }
    return {
        output: {
            schemaVersion: 1,
            command: 'adopt-baseline',
            status: 'adopted',
            kind: payload.kind,
            provenance: payload.provenance,
            authorizesMutation: false,
            target: payload.target,
            inventory: inventory.rel,
            notProven: NOT_PROVEN,
            baseline: file,
        },
        exitCode: 0,
    };
}

// the canonical snapshot shape of an adopted inventory (the baseline values `compareInventory` expects).
const snapshotOfInventory = inv => {
    // the observed values of the given fields of every resource of one section.
    const section = (s, fields) =>
        Object.fromEntries(
            Object.entries(object(inv[s]) ? inv[s] : {}).map(([k, r]) => [
                k,
                Object.fromEntries(fields.map(f => [f, r?.state === 'present' ? r.fields?.[f]?.value : undefined])),
            ]),
        );
    const api = inv.api?.state === 'present' ? inv.api.fields : null;
    return {
        functions: section('functions', ['runtime', 'handler', 'memory', 'timeout', 'codeSha', 'envKeys']),
        tables: section('tables', ['id', 'created', 'stream', 'items']),
        queues: section('queues', ['url', 'created', 'messages']),
        topics: section('topics', ['subscriptions']),
        buckets: section('buckets', ['created', 'objects', 'website', 'policySids']),
        logGroups: section('logGroups', ['created', 'retention']),
        api: inv.api ? { id: api?.id?.value, routes: api?.routes?.value, stages: api?.stages?.value } : null,
        http: {},
    };
};
// the key schemas of an adopted inventory in the `plan.json` `tableProps` form.
const tablePropsOfInventory = inv => ({
    tableProps: Object.fromEntries(
        Object.entries(object(inv.tables) ? inv.tables : {}).map(([k, r]) => [
            k,
            {
                KeySchema: (r?.fields?.keySchema?.value ?? []).map(x => ({
                    AttributeName: x.attributeName,
                    KeyType: x.keyType,
                })),
            },
        ]),
    ),
});

/** the pure first-observation reconcile: a newer discover inventory against the adopted one (same axes). */
export function reconcileFirstObservation({ c, target, baseline, adopted, inventory, deploy, now }) {
    const inv = inventory.payload,
        base = adopted.payload;
    const reasons = new Set();
    for (const p of [inv, base, baseline.payload])
        if (canonical(p.target) !== canonical(identityOf(target)) || p.configFingerprint !== fingerprint(c))
            reasons.add('target-mismatch');
    const started = Date.parse(inv.startedAt);
    if (!Number.isFinite(started) || now - started > STALE_AFTER_MS || started - now > FUTURE_SKEW_MS)
        reasons.add('inventory-stale');
    if ((inv.discovery?.reasons ?? []).length || inv.status === 'blocked') reasons.add('ambiguous-discovery');
    if (inv.stack?.state === 'present') reasons.add('stack-present');
    else if (inv.stack?.state !== 'absent') reasons.add('read-error');
    const errors = inventoryErrors(inv);
    if (errors.length) reasons.add('read-error');
    if (errors.some(e => e.kind === 'target-mismatch')) reasons.add('target-mismatch');
    if (deploy?.status === 'other-target') reasons.add('target-mismatch');
    const cmp = compareInventory({
        c,
        target,
        inv,
        baseline: snapshotOfInventory(base),
        plan: tablePropsOfInventory(base),
        deploy: deploy?.status === 'valid' ? deploy : undefined,
        mode: 'first-observation',
    });
    if (cmp.cfOwned.length) reasons.add('cf-owned-resource');
    // the discovered resource set: a resource found now but not at adoption is a difference.
    const extra = [];
    for (const s of ['tables', 'queues', 'topics', 'buckets', 'logGroups'])
        for (const k of Object.keys(object(inv[s]) ? inv[s] : {}))
            if (!Object.hasOwn(base[s] ?? {}, k))
                extra.push({
                    path: `${s}/${s === 'topics' ? arnName(k) : k}`,
                    axis: 'discovered-resource-set',
                    equal: false,
                    newResource: true,
                });
    if ((inv.api?.fields?.id?.value ?? null) !== (base.api?.fields?.id?.value ?? null) && inv.api && !base.api)
        extra.push({ path: 'api', axis: 'discovered-resource-set', equal: false, newResource: true });
    const entries = [...cmp.entries, ...extra];
    const differing = entries.filter(e => !e.equal);
    const klass = reasons.size ? 'blocked' : differing.length ? 'reconcile-required' : 'verified-no-op';
    return {
        class: klass,
        reasons: REASONS.filter(r => reasons.has(r)),
        errors,
        cmp: { ...cmp, entries, scope: [...new Set([...cmp.scope, 'discovered-resource-set'])].sort() },
        differing,
    };
}

// `reconcile` of a target without run state: a newer discover inventory against the adopted first observation.
async function reconcileObserved(c, options, deps, os) {
    if (options.resolutionFiles?.length) fail('INVALID_ARGS', '--resolution applies to a run state only.');
    const now = (deps.now ?? (() => new Date()))();
    const baseline = await readRecord(os.dir, '', os.baselineFile, KINDS.baseline, 'BASELINE_INVALID');
    if (baseline.payload.provenance !== 'first-observation')
        fail('BASELINE_INVALID', 'Not a first-observation baseline.');
    const adopted = await readRecord(
        os.dir,
        RECORD_DIRS.inventory,
        path.join(os.dir, `${baseline.payload.inventory?.file ?? ''}`),
        KINDS.inventory,
        'BASELINE_INVALID',
    );
    if (adopted.sha256 !== baseline.payload.inventory.sha256)
        fail('BASELINE_INVALID', 'The adopted inventory changed after adoption.');
    const inventory = await readRecord(
        os.dir,
        RECORD_DIRS.inventory,
        options.inventoryFile,
        KINDS.inventory,
        'INVENTORY_INVALID',
    );
    if (inventory.payload.mode !== 'discover')
        fail('INVALID_ARGS', 'Reconcile against a first observation needs a --discover inventory.');
    if (
        inventory.file === adopted.file ||
        inventory.sha256 === adopted.sha256 ||
        !(Date.parse(inventory.payload.startedAt) > Date.parse(adopted.payload.startedAt))
    )
        fail('INVENTORY_NOT_NEWER', 'Reconcile needs a discover inventory newer than the adopted one.');
    const deploy = options.deployReceiptFile ? await readDeployReceipt(options.deployReceiptFile, c) : null;
    const r = reconcileFirstObservation({ c, target: os.target, baseline, adopted, inventory, deploy, now });
    const counts = {
        compared: r.cmp.entries.length,
        equal: r.cmp.entries.filter(e => e.equal).length,
        differing: r.differing.length,
        readErrors: r.errors.length,
    };
    const record = {
        schemaVersion: 1,
        kind: KINDS.reconcile,
        mode: 'first-observation',
        execution: 'offline',
        tool: await (deps.toolRevision ?? toolRevision)(),
        target: identityOf(os.target),
        configFingerprint: fingerprint(c),
        createdAt: iso(now),
        class: r.class,
        reasons: r.reasons,
        runReceipt: 'none',
        baseline: {
            provenance: 'first-observation',
            file: baseline.rel,
            sha256: baseline.sha256,
            inventory: { file: adopted.rel, sha256: adopted.sha256, startedAt: adopted.payload.startedAt },
        },
        inventory: { file: inventory.rel, sha256: inventory.sha256, startedAt: inventory.payload.startedAt },
        notProven: NOT_PROVEN,
        deployReceipt: deploy
            ? {
                  status: deploy.status,
                  ...(deploy.status === 'valid'
                      ? { sha256: deploy.sha256, deployId: deploy.deployId, mode: deploy.mode }
                      : {}),
              }
            : null,
        counts,
        differing: r.differing.map(e => ({
            path: e.path,
            axis: e.axis,
            ...(e.codeSource ? { codeSource: e.codeSource } : {}),
            ...(e.notObserved ? { notObserved: true } : {}),
            ...(e.newResource ? { newResource: true } : {}),
            ...(Object.hasOwn(e, 'expected') && !e.notObserved
                ? { expected: boxed(e.expected), observed: boxed(e.observed) }
                : {}),
        })),
        readErrors: r.errors,
        cfOwned: r.cmp.cfOwned,
        approximate: r.cmp.approximate,
        code: r.cmp.code,
        scope: r.cmp.scope,
        notCompared: r.cmp.notCompared,
    };
    const stem = path.basename(inventory.file, '.json');
    const file = await writeRecord(
        os.dir,
        RECORD_DIRS.inventory,
        `${stem}.reconcile-${stampOf(now)}.json`,
        record,
        deps.onControlWrite,
    );
    return {
        output: {
            schemaVersion: 1,
            command: 'reconcile',
            execution: 'offline',
            mode: 'first-observation',
            class: r.class,
            reasons: r.reasons,
            target: record.target,
            baseline: 'first-observation',
            runReceipt: 'none',
            notProven: NOT_PROVEN,
            counts,
            differing: r.differing.map(e => e.path),
            readErrors: r.errors.map(e => e.path),
            cfOwned: r.cmp.cfOwned,
            approximate: r.cmp.approximate,
            code: r.cmp.code,
            deployReceipt: deploy ? deploy.status : 'not-given',
            scope: r.cmp.scope,
            notCompared: r.cmp.notCompared,
            result: file,
        },
        exitCode: r.class === 'verified-no-op' ? 0 : 3,
    };
}

//* ---- CLI ----

// the flags of the follow-up commands: key, whether it takes a value / repeats, and the commands it belongs to.
const FLAGS = Object.freeze({
    '--config': { key: 'configFile', value: true, path: true, commands: INSPECTION_COMMANDS },
    '--execute': { key: 'execute', commands: ['inspect'] },
    '--http-probe': { key: 'httpProbe', commands: ['inspect'] },
    '--discover': { key: 'discover', commands: ['inspect'] },
    '--inventory': {
        key: 'inventoryFile',
        value: true,
        path: true,
        commands: ['reconcile', 'resolve', 'adopt-baseline'],
    },
    '--deploy-receipt': { key: 'deployReceiptFile', value: true, path: true, commands: ['reconcile'] },
    '--resolution': { key: 'resolutionFiles', value: true, path: true, many: true, commands: ['reconcile'] },
    '--accept': { key: 'accepts', value: true, many: true, commands: ['resolve'] },
    '--reason': { key: 'reason', value: true, commands: ['resolve', 'adopt-baseline'] },
    '--help': { key: 'help', commands: INSPECTION_COMMANDS },
    '-h': { key: 'help', commands: INSPECTION_COMMANDS },
});

/** parse `<inspect|reconcile|resolve|adopt-baseline> [flags]`; an unknown, duplicate or misplaced flag is INVALID_ARGS. */
export function parseInspectionArgs(argv) {
    const command = argv[0];
    if (!INSPECTION_COMMANDS.includes(command)) fail('INVALID_ARGS', 'Unknown command.');
    const result = { command };
    for (let i = 1; i < argv.length; i++) {
        const flag = FLAGS[argv[i]];
        if (!flag || !flag.commands.includes(command) || (!flag.many && result[flag.key] !== undefined))
            fail('INVALID_ARGS', 'Unknown, duplicate or inapplicable argument.');
        if (!flag.value) {
            result[flag.key] = true;
            continue;
        }
        const value = argv[++i];
        if (!value || value.startsWith('--')) fail('INVALID_ARGS', 'Missing argument value.');
        const v = flag.path ? path.resolve(value) : value;
        if (flag.many) (result[flag.key] ??= []).push(v);
        else result[flag.key] = v;
    }
    if (result.help) return result;
    if (!result.configFile) fail('INVALID_ARGS', '--config is required.');
    if (command !== 'inspect' && !result.inventoryFile) fail('INVALID_ARGS', '--inventory is required.');
    if (command === 'resolve' && (!result.accepts?.length || result.reason === undefined))
        fail('INVALID_ARGS', 'resolve needs at least one --accept and --reason.');
    if (command === 'adopt-baseline' && result.reason === undefined)
        fail('INVALID_ARGS', 'adopt-baseline needs --reason.');
    if (result.discover && result.httpProbe) fail('INVALID_ARGS', '--http-probe is not available with --discover.');
    return result;
}

// the usage of the follow-up commands (`<command> --help`; the general `--help` stays the B19/B24 text).
export const INSPECTION_USAGE = [
    'Usage: npm run lambda:migrate -- inspect --config <file> [--execute] [--http-probe | --discover]',
    '       npm run lambda:migrate -- reconcile --config <file> --inventory <file> [--deploy-receipt <file>] [--resolution <file>]...',
    '       npm run lambda:migrate -- resolve --config <file> --inventory <file> --accept <path>=<from>-><to> [--accept ...] --reason <text>',
    '       npm run lambda:migrate -- adopt-baseline --config <file> --inventory <file> --reason <text>',
    'For a stack already migrated by the phases: read-only live inventory (inspect; offline plan without --execute), offline comparison with the run baseline (reconcile), local attestation of the setting DIFF of an unknown verify (resolve).',
    'Without run state in this checkout: inspect --execute --discover, then adopt-baseline (the first observation becomes the baseline), then reconcile a newer --discover inventory.',
    `None of them changes an AWS resource, the receipt, the owner file or the lock. See ${DOC_REF}.`,
].join('\n');

// error codes that are invalid input (exit 2); other known errors exit 1.
const INVALID_INPUT = new Set([
    'INVALID_ARGS',
    'INVALID_INPUT',
    'TARGET_MISMATCH',
    'REVISION_MISMATCH',
    'PLACEHOLDER_INPUT',
    'DEPLOY_RECEIPT_INVALID',
    'RESOLUTION_REFUSED',
    'INVENTORY_STALE',
    'RUN_STATE_PRESENT',
    'ADOPTION_REFUSED',
    'BASELINE_EXISTS',
    'INVENTORY_NOT_NEWER',
]);

// JSON for stdout/stderr with a last guard: the configured account and any ARN are masked.
const publicText = (value, c, pretty = true) => {
    let text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    if (c?.account && /^\d{12}$/.test(c.account)) text = text.replaceAll(c.account, '<account>');
    return text.replace(/arn:aws[a-z-]*:[^\s"]+/g, '<arn>');
};

/**
 * the `lemon-lambda-migrate <inspect|reconcile|resolve>` entry: exit 0 done (`reconcile`: verified-no-op), 1 failed,
 * 2 invalid input, 3 unknown (`inspect`: inventory written with read errors; `reconcile`: not verified).
 */
export async function inspectionMain(argv, deps = {}) {
    const { stdout = console.log, stderr = console.error } = deps;
    let config;
    try {
        const options = parseInspectionArgs(argv);
        if (options.help) {
            stdout(INSPECTION_USAGE);
            return 0;
        }
        config = validateMigrationConfig(await json(options.configFile), options.configFile);
        const root = await (deps.validateRepository ?? validateRepository)(config);
        config.migrationRepo = root;
        const run = {
            inspect: commandInspect,
            reconcile: commandReconcile,
            resolve: commandResolve,
            'adopt-baseline': commandAdopt,
        }[options.command];
        const { output, exitCode } = await run(config, options, deps);
        stdout(publicText(output, config));
        return exitCode;
    } catch (error) {
        const known = error instanceof MigrationError;
        stderr(
            publicText(
                {
                    status: 'failed',
                    code: known ? error.code : 'PREPARATION_FAILED',
                    message: known ? error.message : 'Could not complete the command; raw errors are not logged.',
                },
                config,
                false,
            ),
        );
        return known && INVALID_INPUT.has(error.code) ? 2 : 1;
    }
}
