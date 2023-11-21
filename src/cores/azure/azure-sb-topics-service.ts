/**
 * `sns-service.js`
 * - encrypt/decrypt service api with KMS
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-25 initial azure service bus topics service
 * 
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
/** ****************************************************************************************************************
 *  Common Headers
 ** ****************************************************************************************************************/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, $U, _log, _inf, _err, getHelloArn } from '../../engine';
import { CoreSnsService } from '../core-services';
import { KeyVaultService } from '../azure'
import 'dotenv/config'

const NS = $U.NS('AZTP', 'blue');

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
export class TopicsService implements CoreSnsService {
    /**
     * environ name of SNS KEY
     * - for self messaging.
     */
    public static ENV_SB_TOPICS_ENDPOINT = 'MY_SNS_ENDPOINT';
    public static DEF_SB_TOPICS_ENDPOINT = process.env.AZ_TOPIC_NAME ?? 'topic-lemon';
    protected $kv: KeyVaultService;
    private _arn: string;

    public constructor(arn?: string) {
        this._arn = arn;
    }

    /**
     * get name of this
     */
    public name = () => `service-bus-topics`;

    public static $kv: KeyVaultService = new KeyVaultService();
    public instance = async () => {
        const { ServiceBusClient } = require("@azure/service-bus");
        const connectionString = await TopicsService.$kv.decrypt(process.env.AZ_SB_CONNECTION_STRING)
        const serviceBusClient = new ServiceBusClient(connectionString);
        return { serviceBusClient }
    };
    /**
     * hello
     */
    public hello = () => `az-sb-topics-service:${this._arn || ''}`;


    /**
     * publish message
     *
     * @return {string | object}     message-id
     */
    public publish = async (target: string, subject: string, payload: any): Promise<any> => {
        const endpoint = target ? target : TopicsService.DEF_SB_TOPICS_ENDPOINT;
        const { serviceBusClient } = await this.instance();
        try {
            const sender = serviceBusClient.createSender(endpoint);
            const params = [{
                contentType: "application/json",
                subject: subject,
                body: payload,
            }];

            let batch = await sender.createMessageBatch();
            for (const param of params) {
                if (!batch.tryAddMessage(param)) {
                    // Send the current batch as it is full and create a new one
                    await sender.sendMessages(batch);
                    batch = await sender.createMessageBatch();

                    if (!batch.tryAddMessage(param)) {
                        throw new Error("Message too big to fit in a batch");
                    }
                }
            }

            await sender.sendMessages(batch)
            await sender.close();
            await serviceBusClient.close();
            return
        }
        catch (e) {
            _err(NS, '! err=', e);
            throw e;
        }
    }

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
        _inf(NS, `reportError(${data}, target=${target || ''})...`);
        _err(NS, '> error =', e);

        //! find out endpoint.
        // target = environ(target, 'REPORT_ERROR_ARN', 'lemon-hello-sns');
        target = TopicsService.DEF_SB_TOPICS_ENDPOINT
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