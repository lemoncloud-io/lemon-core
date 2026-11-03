import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareSource } from './local-artifact.mjs';
import { sha256 } from './pack-zip.mjs';
import { ORG_DEFAULTS } from './org-defaults.mjs';

//* v5 B19: the deploy-service pins come from `org-defaults.mjs` (values unchanged).
const DEPLOY = ORG_DEFAULTS.deploy;

export class DeployError extends Error {
    constructor(code, message, { unknown = false } = {}) {
        super(message);
        this.name = 'DeployError';
        this.code = code;
        this.unknown = unknown;
    }
}
export const invalid = field => {
    throw new DeployError('INVALID_INPUT', `Invalid ${field}; see ${DEPLOY.docRef}`);
};
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function keysOnly(value, keys, field) {
    if (!isObject(value) || Object.keys(value).some(k => !keys.includes(k))) invalid(field);
}
export async function readJson(file, field = 'JSON file') {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    } catch {
        invalid(field);
    }
}
const token = (value, re, field) => {
    if (typeof value !== 'string' || !re.test(value)) invalid(field);
    return value;
};
export const DEFAULT_HEADERS = [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent',
    'X-Amzn-Trace-Id',
];
export const CUSTOM_HEADERS = [
    'Authorization',
    'Content-Type',
    'X-Amz-Date',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent',
    'X-Api-Key',
    'X-Lemon-Language',
    'X-Lemon-Identity',
];
export function validateConfig(raw) {
    keysOnly(
        raw,
        [
            'schemaVersion',
            'mode',
            'project',
            'stage',
            'region',
            'account',
            'endpoint',
            'profile',
            'artifactBucket',
            'keyPrefix',
            'environmentFile',
            'policy',
            'routes',
            'deletionProtection',
            'expect',
            'requestTimeoutMs',
            'pollIntervalMs',
            'maxPolls',
            'routeDelayMs',
            //* v5 B47: the optional WebSocket API block (third function `socket`).
            'websocket',
        ],
        'config keys',
    );
    if (raw.schemaVersion !== 1 || !['code', 'bootstrap'].includes(raw.mode)) invalid('schemaVersion/mode');
    const c = { ...raw };
    token(c.project, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-api$/, 'project');
    if (c.project.length > 40 || c.project.startsWith(DEPLOY.reservedProjectPrefix)) invalid('project');
    if (!['dev', 'prod'].includes(c.stage)) invalid('stage');
    token(c.region, /^[a-z]{2}(?:-[a-z]+)+-\d$/, 'region');
    token(c.account, /^\d{12}$/, 'account');
    let u;
    try {
        u = new URL(c.endpoint);
    } catch {
        invalid('endpoint');
    }
    if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.port ||
        !new RegExp(`^[a-z0-9]+\\.execute-api\\.${c.region}\\.amazonaws\\.com$`).test(u.hostname) ||
        !/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
    )
        invalid('endpoint');
    c.endpoint = u.href.replace(/\/$/, '');
    if (c.profile !== undefined) token(c.profile, /^[A-Za-z0-9_.@-]{1,128}$/, 'profile');
    token(c.artifactBucket, /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'artifactBucket');
    if (
        c.artifactBucket.includes('..') ||
        c.artifactBucket.includes('.-') ||
        c.artifactBucket.includes('-.') ||
        /^\d+\.\d+\.\d+\.\d+$/.test(c.artifactBucket)
    )
        invalid('artifactBucket');
    token(c.keyPrefix, /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/, 'keyPrefix');
    if (c.keyPrefix.length > 800) invalid('keyPrefix');
    for (const [k, d, min, max] of [
        ['requestTimeoutMs', 35000, 1000, 60000],
        ['pollIntervalMs', 2000, 250, 10000],
        ['maxPolls', 120, 1, 300],
        ['routeDelayMs', 1500, 1000, 10000],
    ]) {
        c[k] ??= d;
        if (!Number.isInteger(c[k]) || c[k] < min || c[k] > max) invalid(k);
    }
    if (c.expect !== undefined && (typeof c.expect !== 'string' || !c.expect.trim() || c.expect.length > 32768))
        invalid('expect');
    c.policy ??= {};
    keysOnly(
        c.policy,
        ['kmsKeyArn', 'kmsDecryptKeyArn', 'kmsEncryptKeyArn', 'identityPoolId', 'bucket', 'snsPushEndpoints'],
        'policy',
    );
    for (const [k, v] of Object.entries(c.policy)) {
        if (k.endsWith('Arn'))
            token(v, new RegExp(`^arn:aws:kms:${c.region}:${c.account}:key/[a-zA-Z0-9-]+$`), `policy.${k}`);
        if (k === 'identityPoolId') token(v, new RegExp(`^${c.region}:[a-f0-9-]{36}$`), 'policy.identityPoolId');
        if (k === 'bucket') token(v, /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'policy.bucket');
        if (k === 'snsPushEndpoints' && typeof v !== 'boolean') invalid('policy.snsPushEndpoints');
    }
    if (c.mode === 'bootstrap') {
        if (typeof c.environmentFile !== 'string' || !c.environmentFile) invalid('environmentFile');
        if (typeof c.deletionProtection !== 'boolean') invalid('deletionProtection');
        if (!Array.isArray(c.routes) || !c.routes.length || c.routes.length > 100) invalid('routes');
        const seen = new Set();
        for (const r of c.routes) {
            keysOnly(r, ['path', 'httpMethod', 'authorizationType', 'cors'], 'route');
            if (typeof r.path !== 'string' || !r.path.startsWith('/')) invalid('route.path');
            const segments = r.path === '/' ? [] : r.path.slice(1).split('/');
            if (
                segments.some(
                    (part, i) =>
                        !/^(?:[A-Za-z0-9._-]+|\{[A-Za-z0-9_]+\+?\})$/.test(part) ||
                        part === '.' ||
                        part === '..' ||
                        (part.includes('+') && i !== segments.length - 1),
                )
            )
                invalid('route.path');
            if (r.path.split('/').some((s, i, a) => s === '.' || s === '..' || (s.includes('+') && i !== a.length - 1)))
                invalid('route.path');
            if (
                !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(r.httpMethod) ||
                !['NONE', 'AWS_IAM'].includes(r.authorizationType)
            )
                invalid('route method/auth');
            const id = `${r.httpMethod} ${r.path}`;
            if (seen.has(id)) invalid('duplicate route');
            seen.add(id);
            keysOnly(r.cors, ['origin', 'headers', 'credentials', 'allowCredentialsWithWildcardOrigin'], 'route.cors');
            if (
                !Array.isArray(r.cors.headers) ||
                !r.cors.headers.every(h => typeof h === 'string' && /^[A-Za-z0-9-]+$/.test(h)) ||
                typeof r.cors.credentials !== 'boolean'
            )
                invalid('route.cors');
            if (r.cors.origin !== '*' && !/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(r.cors.origin))
                invalid('route.cors.origin');
            if (r.cors.origin !== '*') {
                try {
                    if (new URL(r.cors.origin).origin !== r.cors.origin) invalid('route.cors.origin');
                } catch {
                    invalid('route.cors.origin');
                }
            }
            if (
                r.cors.allowCredentialsWithWildcardOrigin !== undefined &&
                typeof r.cors.allowCredentialsWithWildcardOrigin !== 'boolean'
            )
                invalid('route.cors opt-in');
            if (r.cors.origin === '*' && r.cors.credentials && r.cors.allowCredentialsWithWildcardOrigin !== true)
                invalid('route.cors wildcard credentials opt-in');
        }
        if (!c.routes.some(r => r.path === '/' && r.httpMethod === 'GET' && r.authorizationType === 'NONE'))
            invalid('public GET / route');
        //* v5 B47: bootstrap takes the full block (absent = no WebSocket API, the config is unchanged).
        if (c.websocket !== undefined) c.websocket = validateWebsocket(c.websocket);
    } else if (
        c.environmentFile !== undefined ||
        c.deletionProtection !== undefined ||
        c.routes !== undefined ||
        Object.keys(c.policy).length
    )
        invalid('bootstrap-only config in code mode');
    //* v5 B47: code mode takes `true` or the same block; only its presence matters (the third function must exist).
    else if (c.websocket !== undefined && c.websocket !== true) c.websocket = validateWebsocket(c.websocket);
    return c;
}
//* v5 B47: the default route selection expression of a WebSocket API (the sls `websocketApiRouteSelectionExpression`).
export const WEBSOCKET_ROUTE_SELECTION = '$request.body.action';
//* v5 B47: the default `$connect` handshake budget of the stage probe, in ms (the stage tool's default).
export const WEBSOCKET_PROBE_TIMEOUT_MS = 10000;
//* v5 B47: the `websocket` block, resolved with its defaults — the rules of the deploy service WebSocket tools.
export function validateWebsocket(raw) {
    keysOnly(raw, ['routeSelectionExpression', 'routes', 'probeTimeoutMs'], 'websocket');
    const ws = {
        routeSelectionExpression: raw.routeSelectionExpression ?? WEBSOCKET_ROUTE_SELECTION,
        routes: raw.routes,
        probeTimeoutMs: raw.probeTimeoutMs ?? WEBSOCKET_PROBE_TIMEOUT_MS,
    };
    // the ensure-websocket-api rule: `$request.body.<path>` (optionally `${...}`).
    token(ws.routeSelectionExpression, /^\$\{?request\.body\.[A-Za-z0-9_.]+\}?$/, 'websocket.routeSelectionExpression');
    if (!Number.isInteger(ws.probeTimeoutMs) || ws.probeTimeoutMs < 1000 || ws.probeTimeoutMs > 15000)
        invalid('websocket.probeTimeoutMs');
    // 1–50 routes (the stage tool's `expectRoutes` maximum), each routeKey once.
    if (!Array.isArray(ws.routes) || !ws.routes.length || ws.routes.length > 50) invalid('websocket.routes');
    const seen = new Set();
    ws.routes = ws.routes.map(r => {
        keysOnly(r, ['routeKey', 'authorizationType', 'authorizerId', 'timeoutInMillis'], 'websocket route');
        // a reserved key, or a custom key that does not start with `$` (the ensure-websocket-route rule).
        if (
            typeof r.routeKey !== 'string' ||
            !(/^\$(?:connect|disconnect|default)$/.test(r.routeKey) || /^[A-Za-z0-9_.:-]{1,128}$/.test(r.routeKey))
        )
            invalid('websocket route.routeKey');
        if (seen.has(r.routeKey)) invalid('duplicate websocket route');
        seen.add(r.routeKey);
        if (!['NONE', 'AWS_IAM', 'CUSTOM'].includes(r.authorizationType)) invalid('websocket route.authorizationType');
        // an authorizer id exactly when the route is CUSTOM.
        if ((r.authorizationType === 'CUSTOM') !== (r.authorizerId !== undefined))
            invalid('websocket route.authorizerId');
        if (r.authorizerId !== undefined) token(r.authorizerId, /^[A-Za-z0-9]{1,64}$/, 'websocket route.authorizerId');
        if (
            r.timeoutInMillis !== undefined &&
            (!Number.isInteger(r.timeoutInMillis) || r.timeoutInMillis < 50 || r.timeoutInMillis > 29000)
        )
            invalid('websocket route.timeoutInMillis');
        return { ...r };
    });
    return ws;
}
export async function loadDeployment({ configFile, artifact }) {
    const config = validateConfig(await readJson(configFile, 'config JSON'));
    let environment = {};
    if (config.mode === 'bootstrap') {
        environment = await readJson(
            path.resolve(path.dirname(configFile), config.environmentFile),
            'environment JSON',
        );
        if (
            !isObject(environment) ||
            Object.entries(environment).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]+$/.test(k) || typeof v !== 'string')
        )
            invalid('environment string map');
        if (Object.values(environment).some(v => v.startsWith('*AQIC')) && !config.policy.kmsDecryptKeyArn)
            invalid('policy.kmsDecryptKeyArn for encrypted environment');
    }
    let prepared;
    try {
        prepared = await prepareSource({ artifact });
    } catch {
        invalid('pack artifact integrity');
    }
    try {
        if (prepared.source.runtime !== 'nodejs24.x' || prepared.source.architecture !== 'x86_64')
            invalid('artifact runtime/architecture (requires nodejs24.x/x86_64)');
        const manifestBytes = await readFile(path.join(artifact, 'manifest.json'));
        if (sha256(manifestBytes) !== prepared.source.manifestSha256) invalid('manifest changed during validation');
        const manifest = JSON.parse(manifestBytes);
        if (manifest.archive.bytes > 50000000) invalid('ZIP size (deploy API maximum 50,000,000 bytes)');
        const bytes = await readFile(path.join(artifact, manifest.archive.file));
        if (
            bytes.length !== manifest.archive.bytes ||
            sha256(bytes) !== prepared.source.archiveSha256 ||
            sha256(await readFile(path.join(artifact, 'manifest.json'))) !== prepared.source.manifestSha256
        )
            invalid('artifact changed during validation');
        return {
            config,
            environment,
            artifact: {
                bytes,
                sha256: prepared.source.archiveSha256,
                manifestSha256: prepared.source.manifestSha256,
                fileCount: prepared.source.fileCount,
                handler: `${prepared.handler.file.replace(/\.(?:c?js|mjs)$/, '')}.${prepared.handler.export}`,
                source: {
                    gitSha:
                        typeof manifest.source?.git?.sha === 'string'
                            ? manifest.source.git.sha
                            : manifest.source?.gitSha ?? null,
                    dirty: manifest.source?.git?.dirty ?? manifest.source?.dirty ?? null,
                },
            },
        };
    } finally {
        await prepared.cleanup();
    }
}
export const QUEUE_ATTRIBUTES = Object.freeze({
    MessageRetentionPeriod: '1800',
    VisibilityTimeout: '300',
    MaximumMessageSize: '4096',
    DelaySeconds: '3',
    ReceiveMessageWaitTimeSeconds: '20',
});
export const TABLE_SHAPE = Object.freeze({
    attributeDefinitions: [{ attributeName: '_id', attributeType: 'S' }],
    keySchema: [{ attributeName: '_id', keyType: 'HASH' }],
    billingMode: 'PAY_PER_REQUEST',
    stream: { viewType: 'NEW_AND_OLD_IMAGES' },
});
export const FUNCTION_SHAPES = Object.freeze([
    { memorySize: 512, timeout: 30 },
    { memorySize: 512, timeout: 300 },
]);
//* v5 B47: the shape of the third function `socket` (the sls `socket` function: 512 MB / 300 s).
export const SOCKET_FUNCTION_SHAPE = Object.freeze({ memorySize: 512, timeout: 300 });
//* v5 B47: true when the config has a WebSocket API (`websocket` block, or `true` in code mode).
export const hasWebsocket = c => c.websocket !== undefined;
//* v5 B47: the components of a deployment, in call order — `socket` only with `websocket`.
export const componentsOf = c => (hasWebsocket(c) ? ['lambda', 'backend', 'socket'] : ['lambda', 'backend']);
//* v5 B47: the function shapes in the order of `componentsOf` (`FUNCTION_SHAPES` itself for a two-function config).
export const functionShapesOf = c => (hasWebsocket(c) ? [...FUNCTION_SHAPES, SOCKET_FUNCTION_SHAPE] : FUNCTION_SHAPES);
//* v5 B24: the two functions a deployment targets — the deploy service's sls rule `<project>-<stage>-<component>`.
//  v5 B47: plus `socket` when the config has `websocket` (same rule).
export const plannedFunctionNames = c =>
    Object.freeze(Object.fromEntries(componentsOf(c).map(k => [k, `${c.project}-${c.stage}-${k}`])));
export const LOG_RETENTION_DAYS = 14;
export const SCHEDULE = Object.freeze({
    scheduleExpression: 'cron(0/1 * * * ? *)',
    state: 'DISABLED',
    description: 'run every minute to keep alive',
});
export function deploymentPlan({ config: c, environment, artifact: a }) {
    const source = a.source ?? {};
    //* v5 B47: the WebSocket parts of a bootstrap plan (empty for a config without `websocket`).
    const ws = c.mode === 'bootstrap' && hasWebsocket(c) ? c.websocket : undefined;
    const components = componentsOf(c);
    const n = components.length;
    return {
        schemaVersion: 1,
        mode: c.mode,
        execution: 'offline-plan',
        target: { project: c.project, stage: c.stage, account: c.account, region: c.region, endpoint: c.endpoint },
        artifact: {
            sha256: a.sha256,
            manifestSha256: a.manifestSha256,
            bytes: a.bytes.length,
            fileCount: a.fileCount,
            runtime: 'nodejs24.x',
            architecture: 'x86_64',
            handler: a.handler,
            bucket: c.artifactBucket,
            key: `${c.keyPrefix}/${a.sha256}.zip`,
            source: {
                gitSha: /^[a-f0-9]{40}$/.test(source.gitSha) ? source.gitSha : null,
                dirty: typeof source.dirty === 'boolean' ? source.dirty : null,
            },
        },
        environmentKeys:
            c.mode === 'bootstrap'
                ? [
                      ...new Set([
                          ...Object.keys(environment),
                          'STAGE',
                          'DEFAULT_REGION',
                          'MY_DYNAMO_TABLE',
                          'MY_SQS_ENDPOINT',
                          'MY_SNS_ENDPOINT',
                      ]),
                  ].sort()
                : [],
        verification: {
            event: 'API Gateway GET /',
            expectedPayloadConfigured: c.expect !== undefined,
            ...(c.expect === undefined ? {} : { expectedPayloadSha256: sha256(c.expect) }),
            serverEvidence: 'aggregate verified only',
            ...(c.mode === 'bootstrap'
                ? {
                      publicProbe: { method: 'GET', path: '/', expectStatus: 200 },
                      additionalPublicProbe: c.routes.some(
                          r => r.path === '/hello/{id}' && r.httpMethod === 'GET' && r.authorizationType === 'NONE',
                      )
                          ? '/hello/0'
                          : null,
                      //* v5 B47: the WebSocket stage probe — the `$connect` handshake and every route present.
                      ...(ws ? { websocketProbe: { handshake: 'open', expectRoutes: ws.routes.length } } : {}),
                  }
                : {}),
        },
        ...(c.mode === 'bootstrap'
            ? {
                  configuration: {
                      policy: { profile: DEPLOY.policyProfile, ...c.policy },
                      table: { ...TABLE_SHAPE, deletionProtection: c.deletionProtection },
                      queue: { attributes: QUEUE_ATTRIBUTES },
                      //* v5 B47: one entry per component (`socket` third with `websocket`).
                      functions: functionShapesOf(c).map((shape, i) => ({
                          component: components[i],
                          runtime: 'nodejs24.x',
                          architecture: 'x86_64',
                          handler: a.handler,
                          ...shape,
                          environmentMode: 'merge',
                      })),
                      logRetentionDays: LOG_RETENTION_DAYS,
                      schedule: { ...SCHEDULE, input: { cron: { name: '1MIN', stage: c.stage } } },
                      routes: c.routes,
                      //* v5 B47: the resolved WebSocket block (defaults filled in).
                      ...(ws ? { websocket: ws } : {}),
                  },
              }
            : {
                  configuration: {
                      changes:
                          'Code only; role is reasserted from live preflight. No environment/runtime/handler/memory/timeout changes.',
                  },
              }),
        steps: [
            //* v5 B47: the socket name is resolved too with `websocket`.
            `resolve-names (lemon / sls / backend${hasWebsocket(c) ? ' / socket' : ''})`,
            'resolve-policy + account/region cross-check',
            `read Lambda configuration/tags (${c.mode === 'code' ? 'must exist' : 'absence allowed'})`,
            'deploy.begin',
            'presign-put → conditional ZIP PUT',
            ...(c.mode === 'bootstrap'
                ? [
                      //* v5 B47: the WebSocket API comes first so the one role carries `OwnWebsocketConnections`.
                      ws ? 'WebSocket API → resolve-policy(websocketApiId) → ensure-role' : 'ensure-role',
                      'table / queue / topic',
                      `log groups ×${n}`,
                      `functions ×${n} + verification`,
                      'SNS / DynamoDB stream / SQS mappings',
                      'disabled schedule',
                      `REST API / ${c.routes.length} sequential routes / stage probe`,
                      ...(ws ? [`WebSocket ${ws.routes.length} sequential routes / stage probe`] : []),
                  ]
                : [`existing functions ×${n} code + verification`]),
            'deploy.end',
        ],
        limitations: [
            'Offline plan does not attest cloud state or permission.',
            'Both apply modes require lambda:GetFunctionConfiguration and lambda:ListTags in addition to execute-api:Invoke.',
            'No atomic update-only server contract: a deletion after preflight can race with ensure-function.',
            'Server exposes aggregate verified, not individual verification checks.',
            ...(c.expect === undefined
                ? ['Function invoke-ok does not prove an application HTTP 200; no exact expected payload supplied.']
                : []),
            //* v5 B47: the WebSocket probe is a handshake only (an echo needs the service's own action).
            ...(ws ? ['WebSocket stage probe proves the $connect handshake only; no message round trip is sent.'] : []),
        ],
    };
}
