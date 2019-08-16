/**
 * `sns-service.js`
 * - encrypt/decrypt service api with KMS
 *
 *
 * @author  Steve <steve@lemoncloud.io>
 * @date    2019-07-19 initial version
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ****************************************************************************************************************
 *  Common Headers
 ** ****************************************************************************************************************/
//! import core engine.
import { $engine, $U, _log, _inf, _err } from '../core/engine';
import { EnginePluggable } from 'lemon-engine';
import AWS from 'aws-sdk';

//! module name & namepsace
const name = 'SNS';
const NS = $U.NS(name, 'blue');

export interface CoreSnsService extends EnginePluggable {
    hello: () => { hello: string };
    endpoint: (name: string) => Promise<string>;
    accountID: () => Promise<string>;
    publish: (target: string, subject: string, payload: any) => Promise<string>;
    reportError: (e: Error, message: string, target?: string) => Promise<string>;
}

/** ****************************************************************************************************************
 *  Public Common Interface Exported.
 ** ****************************************************************************************************************/
//TODO - load via environ.
const REGION = 'ap-northeast-2';

//! main service instance.
export const SNS = new (class implements CoreSnsService {
    public ENV_NAME = 'REPORT_ERROR_ARN';
    /**
     * get name of this
     */
    public name = () => `${name}`;

    /**
     * hello
     */
    public hello = () => ({ hello: 'sns-service' });

    /**
     * get target endpoint by name.
     *
     * **LOOKUP SEQUENCE**
     * 1. check if name is valid 'arn'
     * 1. check if $.environ(name)
     * 1. build arn via account-id.
     */
    public endpoint = async (name: string) => {
        if (!name) throw new Error('@name is required!');
        if (name.startsWith('arn:aws:sns:')) return name;
        const env = $engine.environ(name, '') as string;
        if (env && env.startsWith('arn:aws:sns:')) return env;
        return this.accountID().then(_ => {
            _log(NS, '> account-id =', _);
            const arn = ['arn', 'aws', 'sns', REGION, _, name].join(':');
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
                        sts.getCallerIdentity({}, function(err, data) {
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
                });
        });
    };

    /**
     * report error via SNS with subject 'error'
     * - default to `lemon-hello-sns` or using `env[REPORT_ERROR_SNS]`
     *
     * @param e             Error instance
     * @param message       simple text message or object to override.
     * @param target        (default) `lemon-hello-sns`
     */
    public reportError = async (e: Error, message: string, target?: string): Promise<string> => {
        if (!e) return 'N/A';
        _inf(NS, `reportError(${message}, target=${target || ''})...`);
        _err(NS, '> error =', e);

        //! find out endpoint.
        const env = $engine.environ(this.ENV_NAME, '') as string;
        target = target || env || 'lemon-hello-sns';

        //! prepare payload
        const e2: any = e;
        const stack = e.stack;
        const errors = (e2.body && e2.body.errors) || undefined;
        const error = message && typeof message == 'string' ? message : `${e.message || e2.statusMessage || e}`;
        const base = message && typeof message == 'object' ? message : {};
        const payload = Object.assign(base, {
            'stack-trace': stack,
            message: undefined as string,
            error: error,
            errors,
        });

        //! root of errors.
        const error0 = (errors && errors[0]) || undefined;
        if (error0) {
            payload.message = payload.error;
            payload.error = error0;
        }
        // _log(NS, '> payload =', $U.json(payload));
        return this.publish(target, 'error', payload).catch(e => {
            return `ERROR - ${(e && e.message) || e}`;
        });
    };
})();
