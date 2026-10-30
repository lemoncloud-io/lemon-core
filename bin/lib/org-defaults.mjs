/**
 * `bin/lib/org-defaults.mjs` (lemon-core)
 * - the organisation-specific defaults of the deploy / migrate tools, in one place.
 * - every per-installation value (account, region, endpoint, profile, bucket, project, stage) comes from the
 *   consumer's config file; nothing here is a hostname, an account number, an ARN or a token.
 * - these are contract pins of the deploy service (`eureka-deploy` tools) and of the one supported migration.
 */
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
        // prefix of the abort reason sent to `end` (`<prefix>:<error code>`).
        abortReasonPrefix: 'templates-cli',
        // where the config contract is documented (error messages).
        docRef: 'lemon-core docs/v5/B19-bin-deploy.md',
    }),
    //* the one supported migration (`lemon-lambda-migrate`, `lemon-lambda-deploy-dev`): a Serverless dev stack
    //  moved to the deploy service by the canonical migration script at a pinned revision.
    migration: Object.freeze({
        // the only supported target (config must match exactly).
        target: Object.freeze({ project: 'lemon-templates-api', stage: 'dev', stack: 'lemon-templates-api-dev' }),
        // pinned commit of the canonical migration checkout.
        revision: '66d1e91a60a240765d44dedfdab73a92af6abd51',
        // `owner/repo` the checkout's `origin` remote must point to.
        origin: 'lemoncloud-io/eureka-deploy-api',
        // tracked files of the checkout that are hash-checked against the pinned blob.
        entry: 'scripts/migrate/migrate.mjs',
        imports: 'scripts/agt/common.mjs',
        // private run-state dir of the checkout (`<runsDir>/<stack>`).
        runsDir: 'scripts/migrate/runs',
        // private run-state file names and the owner tag.
        receiptFile: 'templates-receipt.json',
        ownerFile: 'templates-owner.json',
        lockFile: 'templates.lock',
        ownerTool: 'templates-migrate',
        // temp-dir prefix of the dev-release config copy.
        devConfigPrefix: 'templates-dev-config-',
    }),
});
