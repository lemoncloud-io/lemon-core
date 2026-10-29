/**
 * `sns-service.js`
 * - encrypt/decrypt service api with KMS
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-19 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 * @date        2026-10-30 `publish()`: the local transport (`LOCAL_TRANSPORT=mock`) delivers in-process, no AWS call.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, $U, _log, _inf, _err, getHelloArn, LemonEngine } from '../../engine';
const NS = (() => {
    let ns: string | undefined;
    return () => (ns ??= $U.NS('SNS', 'blue'));
})();

import { asErrorPayload } from '../../common/test-helper';
import { CoreSnsService } from '../core-services';
import { awsConfig, AwsConfigParams } from '../../tools';
import { measureAsync } from '../../lib/perf';
import { safeStringify } from '../../lib/safe-json'; //* v5 B10-2: circular-safe stringify for the payload (internal).
import { isActive as isLocalTransport, localSns } from '../protocol/local-transport';

/**
 * SDK packages, imported on the first use (not at import: this file is in the engine closure; v5 B2-c, K6).
 * - each loader is memoized, and its first call prints one `PERF` line.
 */
let $sns: Promise<typeof import('@aws-sdk/client-sns')>;
let $iam: Promise<typeof import('@aws-sdk/client-iam')>;
let $sts: Promise<typeof import('@aws-sdk/client-sts')>;
// loader of `@aws-sdk/client-sns`.
const loadSns = () =>
    ($sns ??= measureAsync(
        _inf,
        $U.NS('PERF', 'cyan'),
        'lazy-load @aws-sdk/client-sns',
        () => import('@aws-sdk/client-sns'),
    ));
// loader of `@aws-sdk/client-iam`.
const loadIam = () =>
    ($iam ??= measureAsync(
        _inf,
        $U.NS('PERF', 'cyan'),
        'lazy-load @aws-sdk/client-iam',
        () => import('@aws-sdk/client-iam'),
    ));
// loader of `@aws-sdk/client-sts`.
const loadSts = () =>
    ($sts ??= measureAsync(
        _inf,
        $U.NS('PERF', 'cyan'),
        'lazy-load @aws-sdk/client-sts',
        () => import('@aws-sdk/client-sts'),
    ));

const region = (): string => $engine.environ('REGION', 'ap-northeast-2') as string;

/**
 * use `target` as value or environment value.
 * environ('abc') => string 'abc'
 * environ('ABC') => use `env.ABC`
 */
const environ = (target: string, defEnvName: string, defEnvValue: string) => {
    const isUpperStr = target && /^[A-Z][A-Z0-9_]+$/.test(target);
    defEnvName = isUpperStr ? target : defEnvName;
    const val = defEnvName ? ($engine.environ(defEnvName, defEnvValue) as string) : defEnvValue;
    target = isUpperStr ? '' : target;
    return `${target || val}`;
};

/**
 * main service instance.
 */
export class AWSSNSService implements CoreSnsService {
    /**
     * environ name of SNS KEY
     * - for self messaging.
     */
    public static ENV_SNS_ENDPOINT = 'MY_SNS_ENDPOINT';
    public static DEF_SNS_ENDPOINT = 'lemon-hello-sns';

    private _arn: string;
    public constructor(arn?: string) {
        this._arn = arn;
    }

    /**
     * get name of this
     */
    public name = () => `SNS`;

    /**
     * hello
     */
    public hello = () => `aws-sns-service:${this._arn || ''}`;

    /**
     * get target endpoint by name.
     */
    public endpoint = async (target?: string) => {
        target = target || this._arn;
        target = environ(target, AWSSNSService.ENV_SNS_ENDPOINT, AWSSNSService.DEF_SNS_ENDPOINT);
        if (!target) throw new Error(`@target (or env.${AWSSNSService.ENV_SNS_ENDPOINT}) is required!`);
        if (target.startsWith('arn:aws:sns:')) return target;
        const REGION = region();
        //* via hello-arn(see env.REPORT_ERROR_ARN), build arn.
        try {
            const arn: string = getHelloArn(null, NS());
            if (arn && arn.startsWith('arn:aws:sns:')) {
                const arns = arn.split(':');
                arns[3] = REGION;
                arns[5] = target;
                return arns.join(':');
            }
        } catch (e) {
            _log(NS(), `! ignored.err =`, e);
        }

        // # suggested by https://groups.google.com/forum/#!topic/boto-users/QhASXlNBm40
        // # account_id = boto.connect_iam().get_user().arn.split(':')[4]
        return this.accountID().then(_ => {
            _log(NS(), '> account-id =', _);
            const arn = ['arn', 'aws', 'sns', REGION, _, target].join(':');
            return arn;
        });
    };

    /**
     * get current aws account-id.
     *
     * refer: `https://stackoverflow.com/questions/35563270/finding-my-aws-account-id-using-javascript`
     */
    public accountID = async (engine?: LemonEngine, $cfg?: AwsConfigParams): Promise<string> => {
        //* load both packages first; the executor below stays as it was (sync).
        const [{ IAMClient, GetUserCommand }, { STSClient, GetCallerIdentityCommand }] = await Promise.all([
            loadIam(),
            loadSts(),
        ]);
        return new Promise((resolve, reject) => {
            const cfg = awsConfig(engine ?? $engine, $cfg);
            const iam = new IAMClient(cfg);
            iam.send(new GetUserCommand({}))
                .then(data => {
                    resolve(data.User?.Arn.split(':')[4]);
                })
                .catch(err => {
                    const msg = `${err.message || err}`;
                    if (msg === 'Must specify userName when calling with non-User credentials') {
                        const sts = new STSClient(cfg);
                        return sts
                            .send(new GetCallerIdentityCommand({}))
                            .then(data => resolve(data?.Account))
                            .catch(e => reject(e));
                    }
                    //* otherwise, call internal resource. (ECS, EC2)
                    _err(NS(), '! err@1 =', err);
                    //NOTE! - below will be fail in lambda.
                    // MetadataService ia deprecated.
                    // const metadata = new AWS.MetadataService();
                    // metadata.request('/latest/meta-data/iam/info/', (err, data) => {
                    //     if (err) reject(err);
                    //     else resolve(JSON.parse(data).InstanceProfileArn.split(':')[4]);
                    // });
                    _err(NS(), '! err@2 =', err);
                    reject(err);
                });
        });
    };

    /**
     * publish message
     *
     * @return {string | object}     message-id
     */
    public publish = async (target: string, subject: string, payload: any): Promise<string> => {
        _inf(NS(), `publish(${target}, ${subject})...`);
        //* local transport (opt-in, local mode only): deliver to this service in-process (no endpoint lookup, no AWS call).
        if (isLocalTransport()) {
            const message = payload && typeof payload == 'object' ? safeStringify(payload) : `${payload ?? ''}`;
            //* no target and no env `MY_SNS_ENDPOINT` (a local run) → '' = this service's topic (Lambda sets the env to it).
            const $target = target || this._arn;
            const hasEnv = !!$engine.environ(AWSSNSService.ENV_SNS_ENDPOINT, '');
            return localSns($target || hasEnv ? snsTargetOf($target) : '', { Subject: subject, Message: message });
        }
        const arn = await this.endpoint(target);
        if (!arn) throw new Error(`.arn is required! target:${target}`);
        //* v5 B10-2: stringify the payload once, circular-safe (a circular `data`·`context` must not drop the report).
        const body = payload && typeof payload == 'object' ? safeStringify(payload) : payload;
        _log(NS(), `> payload[${arn}] =`, payload && typeof payload == 'object' ? body : $U.json(payload));
        const params = {
            TopicArn: arn,
            Subject: subject,
            Message: JSON.stringify({
                default: body,
            }),
            MessageStructure: 'json',
        };
        // _log(NS, '> params =', params);
        //* call sns.publish()
        const region = arn.split(':')[3];
        if (!region) throw new Error(`@region is required. arn:${arn}`);
        const cfg = awsConfig($engine, region);
        const { SNSClient, PublishCommand } = await loadSns(); // a new client per call (no `PERF > client` line).
        const sns = new SNSClient(cfg);
        return sns
            .send(new PublishCommand(params))
            .then(res => {
                _log(NS(), `> result[${arn}] =`, typeof res === 'string' ? res : $U.json(res));
                return (res && res.MessageId) || '';
            })
            .catch(e => {
                _err(NS(), '! err=', e);
                throw e;
            });
    };

    /**
     * report error via SNS with subject 'error'
     * - default to `lemon-hello-sns` or using `env[REPORT_ERROR_ARN]`
     *
     * @param e             Error instance
     * @param data          simple text message or object to override.
     * @param target        (optional) target SNS arn (default is `REPORT_ERROR_ARN`)
     */
    public reportError = async (e: Error, data: any, target?: string): Promise<string> => {
        if (!e) return 'N/A';
        _inf(NS(), `reportError(${data}, target=${target || ''})...`);
        _err(NS(), '> error =', e);

        //* find out endpoint.
        target = environ(target, 'REPORT_ERROR_ARN', 'lemon-hello-sns');
        const payload = this.asPayload(e, data);

        // _log(NS(), '> payload =', $U.json(payload));
        return this.publish(target, 'error', payload).catch(e => {
            return `ERROR - ${(e && e.message) || e}`;
        });
    };

    /**
     * convert Error to payload.
     */
    public asPayload = (e: any, data: string | object) => {
        return asErrorPayload(e, data);
    };
}

/**
 * the SNS target (topic name or ARN) by the same rule as `endpoint()`: `''` → env `MY_SNS_ENDPOINT` (or
 * `lemon-hello-sns`), an upper-case name → that env value, else as is. no ARN lookup (no AWS call).
 */
export const snsTargetOf = (target?: string): string =>
    environ(target, AWSSNSService.ENV_SNS_ENDPOINT, AWSSNSService.DEF_SNS_ENDPOINT);
