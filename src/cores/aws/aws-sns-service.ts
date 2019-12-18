/**
 * `sns-service.js`
 * - encrypt/decrypt service api with KMS
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-19 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ****************************************************************************************************************
 *  Common Headers
 ** ****************************************************************************************************************/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, $U, _log, _inf, _err, getHelloArn } from '../../engine';
const NS = $U.NS('SNS', 'blue');

import AWS from 'aws-sdk';
import { CoreSnsService } from '../core-services';

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

/** ****************************************************************************************************************
 *  Public Instance Exported.
 ** ****************************************************************************************************************/
//! main service instance.
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
        //! via hello-arn(see env.REPORT_ERROR_ARN), build arn.
        try {
            const arn: string = getHelloArn(null, NS);
            if (arn && arn.startsWith('arn:aws:sns:')) {
                const arns = arn.split(':');
                arns[3] = REGION;
                arns[5] = target;
                return arns.join(':');
            }
        } catch (e) {
            _log(NS, `! ignored.err =`, e);
        }

        // # suggested by https://groups.google.com/forum/#!topic/boto-users/QhASXlNBm40
        // # account_id = boto.connect_iam().get_user().arn.split(':')[4]
        return this.accountID().then(_ => {
            _log(NS, '> account-id =', _);
            const arn = ['arn', 'aws', 'sns', REGION, _, target].join(':');
            return arn;
        });
    };

    /**
     * get current aws account-id.
     *
     * refer: `https://stackoverflow.com/questions/35563270/finding-my-aws-account-id-using-javascript`
     */
    public accountID = async (): Promise<string> => {
        return new Promise((resolve, reject) => {
            const iam = new AWS.IAM();
            iam.getUser({}, (err, data) => {
                if (!err) {
                    resolve(data.User.Arn.split(':')[4]);
                } else if (err) {
                    const msg = `${err.message || err}`;
                    //! if non-User case. call STS().
                    if (msg == 'Must specify userName when calling with non-User credentials') {
                        const sts = new AWS.STS();
                        sts.getCallerIdentity({}, (err, data) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(data.Account);
                            }
                        });
                        return;
                    }
                    //! otherwise, call internal resource. (ECS, EC2)
                    _err(NS, '! err@1 =', err);
                    //NOTE! - below will be fail in lambda.
                    const metadata = new AWS.MetadataService();
                    metadata.request('/latest/meta-data/iam/info/', (err, data) => {
                        if (err) reject(err);
                        else resolve(JSON.parse(data).InstanceProfileArn.split(':')[4]);
                    });
                }
            });
        });
    };

    /**
     * publish message
     *
     * @return {string | object}     message-id
     */
    public publish = async (target: string, subject: string, payload: any): Promise<string> => {
        _inf(NS, `publish(${target}, ${subject})...`);
        return this.endpoint(target).then(arn => {
            if (!arn) throw new Error('.arn is required! target:' + target);
            _log(NS, `> payload[${arn}] =`, $U.json(payload));
            const params = {
                TopicArn: arn,
                Subject: subject,
                Message: JSON.stringify({
                    default: payload && typeof payload == 'object' ? JSON.stringify(payload) : payload,
                }),
                MessageStructure: 'json',
            };
            // _log(NS, '> params =', params);
            //! call sns.publish()
            const region = arn.split(':')[3];
            if (!region) throw new Error('region is required. arn:' + arn);
            const sns = new AWS.SNS({ region });
            return sns
                .publish(params)
                .promise()
                .then(result => {
                    _log(NS, `> result[${arn}] =`, result);
                    return (result && result.MessageId) || '';
                })
                .catch(e => {
                    _err(NS, '! err=', e);
                    throw e;
                });
        });
    };

    /**
     * report error via SNS with subject 'error'
     * - default to `lemon-hello-sns` or using `env[REPORT_ERROR_ARN]`
     *
     * @param e             Error instance
     * @param message       simple text message or object to override.
     * @param target        (optional)
     */
    public reportError = async (e: Error, data: any, target?: string): Promise<string> => {
        if (!e) return 'N/A';
        _inf(NS, `reportError(${data}, target=${target || ''})...`);
        _err(NS, '> error =', e);

        //! find out endpoint.
        target = environ(target, 'REPORT_ERROR_ARN', 'lemon-hello-sns');
        const payload = this.asPayload(e, data);

        // _log(NS, '> payload =', $U.json(payload));
        return this.publish(target, 'error', payload).catch(e => {
            return `ERROR - ${(e && e.message) || e}`;
        });
    };

    /**
     * convert Error to payload.
     */
    public asPayload = (e: any, data: string | object) => {
        //TODO - optimize message extractor.
        const $message = (e: any) => {
            const m = (e && (e.message || e.statusMessage)) || e;
            return typeof m == 'object' ? $U.json(m) : `${m}`;
        };
        //! prepare payload
        const e2: any = e;
        const base = data && typeof data == 'object' ? data : {};
        const message = data && typeof data == 'string' ? data : $message(e);
        const stack = e instanceof Error ? e.stack : undefined;
        const error = typeof e == 'string' ? e : e instanceof Error ? `${e.message}` : JSON.stringify(e);
        const errors = e2.errors || (e2.body && e2.body.errors) || undefined;
        const payload: { 'stack-trace'?: any; message: string; error: string; errorss?: any[] } = Object.assign(base, {
            'stack-trace': stack,
            message,
            error,
            errors,
        });

        //! root of errors.
        const error0 = (errors && errors[0]) || undefined;
        if (error0) {
            payload.message = $message(payload.error);
            payload.error = error0 instanceof Error ? `${e.message}` : JSON.stringify(error0);
        }

        //! returns payload for sns error
        return payload;
    };
}
