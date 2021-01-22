/**
 * `lambda-notification-handler.ts`
 * - lambda handler to process SNS http/https Notification + Subscriptions.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-17 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, $_ } from '../../engine/';
import { NextContext, NextHandler } from './../core-services';
import {
    LambdaHandler,
    LambdaSubHandler,
    NotificationHandler,
    WEBEvent,
    Context,
    buildReportError,
} from './lambda-handler';
import { success } from './lambda-web-handler';
import { APIGatewayEventRequestContext } from 'aws-lambda';
const NS = $U.NS('HNOT', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * param for containing headers infor
 * - "x-amz-sns-message-id": "ef9765be-a053-40d8-907b-4a212b8a8b6e",
 * - "x-amz-sns-message-type": "SubscriptionConfirmation",
 * - "x-amz-sns-topic-arn": "arn:aws:sns:ap-northeast-2:796730245826:lemon-todaq-out",
 * - "X-Forwarded-For": "54.239.116.71, 52.46.53.153",
 */
export interface NotificationParam {
    snsMessageType?: string; // message-type.
    snsMessageId?: string; // message-id
    snsTopicArn?: string;
    snsSubscriptionArn?: string;
    subscribeURL?: string; // Only for 'SubscriptionConfirmation'
    signature?: string; // Signature to Verify.
    subject?: string; // Message Subject.
    /**
     * custom attributes from origin SNS published.
     */
    [key: string]: string | number;
}
export interface NotificationBody {
    [key: string]: any;
}

/**
 * `NextHandler` for `Notification` Event.
 * @param id        Request path of HTTP SNS or something.
 * @param param     NotificationParam
 * @param body      NotificationBody - any payload from origin.
 * @param ctx       Origin Event Infor.
 */
export type NotificationNextHandler = NextHandler<NotificationParam, string, NotificationBody>;

/**
 * class: `LambdaNotificationHandler`
 * - default Notification Handler via SNS http/https subscription.
 */
export class LambdaNotificationHandler extends LambdaSubHandler<NotificationHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'notification' : undefined);
        // _log(NS, `LambdaNotificationHandler(${register})..`);
    }

    protected listeners: NotificationNextHandler[] = [];

    /**
     * add listener.
     * @param handler
     */
    public addListener(handler: NotificationNextHandler) {
        this.listeners.push(handler);
    }

    /**
     * Notification Handler.
     */
    public handle: NotificationHandler = async (event, context) => {
        _log(NS, `handle()....`);
        // _log(NS, '! event =', $U.json(event));
        // _log(NS, '> event =', $U.json(event));
        const $doReportError = buildReportError(LambdaNotificationHandler.REPORT_ERROR);

        // _inf(NS, '! event.headers =', $U.json(event.headers));
        // _inf(NS, '! context =', $U.json(context));
        _log(NS, '! path =', event.path);
        const id = `${event.path}`;
        const { param, body } = this.packNotificationParamBody(event);
        //! call all listeners in parrallel.
        const asyncNext = (fn: NextHandler, i: number) =>
            new Promise(resolve => {
                resolve(fn(id, param, body, context));
            }).catch(e => $doReportError(e, null, null, { param, body, i }));
        const res = await Promise.all(this.listeners.map(asyncNext));
        const ret = success(res.join(','));
        return ret;
    };

    /**
     * Pack context as `NextContext`
     * @param event     origin lambda event
     * @param $ctx      origin context.
     */
    public async packContext(event: WEBEvent, $ctx: Context): Promise<NextContext> {
        _log(NS, `packContext()....`);
        // _log(NS, '! event =', $U.json(event));
        _log(NS, '! $ctx =', $U.json($ctx));
        const headers = (event && event.headers) || {};
        const reqContext: APIGatewayEventRequestContext = event && event.requestContext;

        //! - extract original request infor.
        const clientIp = reqContext && reqContext.identity && reqContext.identity.sourceIp;
        const requestId = reqContext && reqContext.requestId;
        const accountId = reqContext && reqContext.accountId;
        const domain = (reqContext && reqContext.domainName) || headers['Host'] || headers['host'];

        //! save into headers and returns.
        const context: NextContext = { clientIp, requestId, accountId, domain };
        return context;
    }

    /**
     * pack to notification-param via origin event.
     * @param event     origin lambda event
     */
    public packNotificationParamBody(event: WEBEvent): { param: NotificationParam; body: NotificationBody } {
        _log(NS, `packNotificationParam()....`);
        // _log(NS, '! event =', $U.json(event));
        _inf(NS, '! event.headers =', $U.json(event.headers));
        const headers = (event && event.headers) || {};
        const $ctx: APIGatewayEventRequestContext = event && event.requestContext;
        const method = ($ctx && $ctx.httpMethod) || event.httpMethod || '';
        if (method != 'POST') throw new Error(`.httpMethod (${method}) is not valid`);

        //! parse message body.
        const hasRaw = headers['x-amz-sns-rawdelivery'] !== undefined ? true : false;
        const isRaw = headers['x-amz-sns-rawdelivery'] === 'true' ? true : false;
        const isBase64Encoded = event.isBase64Encoded;
        const ctype = `${headers['content-type'] || headers['Content-Type'] || ''}`;
        const json = (body: any) => {
            const text = !body ? '' : typeof body == 'string' ? body : $U.json(body);
            if (text.startsWith('{') && text.endsWith('}')) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    return { text };
                }
            }
            return { text };
        };
        const data = json(event.body); //! body must be string formatted json.
        _log(NS, `> data[${ctype}][${isBase64Encoded ? 'base64' : typeof event.body}] =`, $U.json(data));

        //! prepare param via headers.
        const param: NotificationParam = {
            snsMessageType: headers['x-amz-sns-message-type'],
            snsMessageId: headers['x-amz-sns-message-id'],
            snsTopicArn: headers['x-amz-sns-topic-arn'],
            snsSubscriptionArn: headers['x-amz-sns-subscription-arn'], // only for Notification.
        };
        const body: NotificationBody = hasRaw && isRaw ? { ...data } : { ...json(data.Message || '') };

        //! parse message-attribute of SNS
        if (!isRaw) {
            if (param.snsMessageType == 'SubscriptionConfirmation') {
                param.subscribeURL = data.SubscribeURL;
                param.signature = data.Signature;
            } else if (data.MessageAttributes) {
                //! retrieve message-attributes as `param`
                const attrs = Object.keys(data.MessageAttributes).reduce((O: any, key: string) => {
                    const V = data.MessageAttributes[key];
                    if (!V) return O;
                    O[key] = V.Type == 'Number' ? Number(V.Value) : `${V.Value}`;
                    return O;
                }, {});
                const subject = data.Subject || '';
                Object.assign(param, attrs); // merge attributes to param.
                param.subject = subject;
            }
        }

        //! returns...
        return { param, body };
    }
}
