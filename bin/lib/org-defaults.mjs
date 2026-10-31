/**
 * `bin/lib/org-defaults.mjs` (lemon-core)
 * - the organisation-specific defaults of the deploy / migrate tools, in one place.
 * - every per-installation value (account, region, endpoint, profile, bucket, project, stage) comes from the
 *   consumer's config file; nothing here is a hostname, an account number, an ARN or a token.
 * - these are contract pins of the deploy service (`eureka-deploy` tools) and of the reviewed migration targets.
 */
//* v5 B24: pinned commit of the canonical migration checkout (templates and hello were rehearsed at it).
//  v5 B28: the eureka-hello entry uses it too; its rehearsal record is pending.
const PINNED_REVISION = '66d1e91a60a240765d44dedfdab73a92af6abd51';
//* v5 B24: private run-state names of a target added after B19 (named after the tool, not the service).
const GENERIC_STATE = Object.freeze({
    receiptFile: 'migrate-receipt.json',
    ownerFile: 'migrate-owner.json',
    lockFile: 'migrate.lock',
    ownerTool: 'lemon-lambda-migrate',
    devConfigPrefix: 'lemon-dev-config-',
});
//* v5 B24: one frozen registry entry (identity, pinned revision, private run-state names).
function target({ project, stage, stack, revision, receiptFile, ownerFile, lockFile, ownerTool, devConfigPrefix }) {
    return Object.freeze({
        project,
        stage,
        stack,
        revision,
        receiptFile,
        ownerFile,
        lockFile,
        ownerTool,
        devConfigPrefix,
    });
}

//* v5 B19: org-specific defaults gathered from the templates-api `bin/` tools (values unchanged).
export const ORG_DEFAULTS = Object.freeze({
    //* the deploy service the `lemon-lambda-deploy` tools call (`<endpoint>/tools/<namespace>.<tool>@1`).
    deploy: Object.freeze({
        // name of the deploy service (help text only).
        serviceName: 'eureka-deploy',
        // a project name may not start with this (the deploy service itself is not a deploy target).
        reservedProjectPrefix: 'eureka-deploy',
        // namespace of the deploy-service tools (`lemon.deploy.begin@1`, ...).
        toolNamespace: 'lemon.deploy',
        // IAM policy profile asked from `resolve-policy`.
        policyProfile: 'lemon-standard',
        // prefix of the abort reason sent to `end` (`<prefix>:<error code>`), for every project not in the map below.
        abortReasonPrefix: 'lemon-lambda-deploy',
        //* v5 B24: per-project legacy prefix, kept byte-identical for the deploy records of that project.
        abortReasonPrefixes: Object.freeze({ 'lemon-templates-api': 'templates-cli' }),
        // where the config contract is documented (error messages).
        docRef: 'lemon-core docs/v5/B19-bin-deploy.md',
    }),
    //* the reviewed migrations (`lemon-lambda-migrate`, `lemon-lambda-deploy-dev`): a Serverless dev stack moved to
    //  the deploy service by the canonical migration script at a pinned revision.
    migration: Object.freeze({
        //* v5 B24: the reviewed target registry. A config must match exactly one entry (project, stage, stack);
        //  each entry is rehearsed at its pinned revision before it ships (a lemon-core change and release).
        targets: Object.freeze([
            // the B19 target: values and state-file names unchanged.
            target({
                project: 'lemon-templates-api',
                stage: 'dev',
                stack: 'lemon-templates-api-dev',
                revision: PINNED_REVISION,
                receiptFile: 'templates-receipt.json',
                ownerFile: 'templates-owner.json',
                lockFile: 'templates.lock',
                ownerTool: 'templates-migrate',
                devConfigPrefix: 'templates-dev-config-',
            }),
            // v5 B24: rehearsed at the pinned revision (canonical migration skill, 2026-10-30 sandbox `verify` all same).
            target({
                project: 'lemon-hello-api',
                stage: 'dev',
                stack: 'lemon-hello-api-dev',
                revision: PINNED_REVISION,
                ...GENERIC_STATE,
            }),
            // v5 B28: added at the pinned revision; rehearsal record pending (owner: "rehearse, then migrate"). The
            //  entry ships only after a sandbox rehearsal through `verify` (all same) is recorded.
            target({
                project: 'eureka-hello-api',
                stage: 'dev',
                stack: 'eureka-hello-api-dev',
                revision: PINNED_REVISION,
                ...GENERIC_STATE,
            }),
        ]),
        // `owner/repo` the checkout's `origin` remote must point to.
        origin: 'lemoncloud-io/eureka-deploy-api',
        // tracked files of the checkout that are hash-checked against the pinned blob.
        entry: 'scripts/migrate/migrate.mjs',
        imports: 'scripts/agt/common.mjs',
        // private run-state dir of the checkout (`<runsDir>/<stack>`, so state names never collide across stacks).
        runsDir: 'scripts/migrate/runs',
    }),
});
