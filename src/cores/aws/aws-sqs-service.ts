/**
 * `aws-sqs-service.ts`
 * - sqs service for AWS `SQS`.
 *
 *
 * //TODO - move to `lemon-core` shared lib.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-27 initial version
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U } from '../../engine/';
const NS = $U.NS('SQSS', 'blue'); // NAMESPACE TO BE PRINTED.

import AWS, { SQS } from 'aws-sdk';
import { CoreServices } from '../core-services';

/**
 * interface: SQSService
 * - common interface type for `SQS`
 */
export interface SQSService extends CoreServices {
    sendMessage(data: any, attr?: SQSAttribute): Promise<string>;
    receiveMessage(size?: number): Promise<{ list: SqsMessage[] }>;
    deleteMessage(handle: string): Promise<void>;
    statistics(): Promise<SqsStatistics>;
}

export interface SQSAttribute {
    [key: string]: string | number;
}

export interface SqsMessage {
    sent: number;
    attr: SQSAttribute;
    data: any;
    id: string;
    handle: string;
}

export interface SqsStatistics {
    available: number;
    inflight: number;
    delayed: number;
    timeout: number;
}

export interface SqsRecord {
    messageId: string;
    receiptHandle: string;
    body: string;
    attributes: any;
    messageAttributes: any;
    md5OfBody: string;
    md5OfMessageAttributes: string;
    eventSource: 'aws:sqs';
    eventSourceARN: string;
    awsRegion: string;
}

/**
 * class: AWSSQSService
 * - support of AWS `SQS` Service
 */
export class AWSSQSService implements SQSService {
    public static SQS_REGION = 'MY_SQS_REGION';
    public static SQS_ENDPOINT = 'MY_SQS_ENDPOINT';

    protected _region: string;
    protected _endpoint: string;

    /**
     * default constructor.
     */
    public constructor(endpoint?: string, region?: string) {
        region = region || ($engine.environ(AWSSQSService.SQS_REGION, 'ap-northeast-2') as string) || '';
        endpoint = endpoint || ($engine.environ(AWSSQSService.SQS_ENDPOINT, '') as string) || '';
        // const stage = $engine.environ('STAGE', '') as string;
        // if (!endpoint && stage != 'local')
        //     throw new Error(`env.${AWSSQSService.SQS_ENDPOINT} is required w/ stage:${stage}`);
        _log(NS, `AWSSQSService(${endpoint}, ${region})...`);
        this._region = region;
        this._endpoint = endpoint;
    }
    public region(): string {
        return this._region;
    }
    public endpoint(): string {
        return this._endpoint;
    }
    /**
     * hello
     */
    public hello = () => `aws-sqs-service:${this._endpoint || ''}`;

    /**
     * send message into SQS.
     *
     * @param data      object data to be json.
     * @param attr      attribute set.
     */
    public async sendMessage(data: any, attr?: SQSAttribute): Promise<string> {
        if (!data) throw new Error('@data(object) is required!');
        //! prepare params.
        const asAttr = (param: any) =>
            Object.keys(param || {}).reduce((O: any, key: string) => {
                const val = param[key];
                const isNum = typeof val === 'number' ? true : false;
                O[key] = {
                    DataType: isNum ? 'Number' : 'String',
                    StringValue: `${val}`,
                };
                return O;
            }, {});
        const params: SQS.Types.SendMessageRequest = {
            // DelaySeconds: 10, //NOTE - use SQS's configuration.
            MessageAttributes: asAttr(attr),
            MessageBody: $U.json(data && typeof data == 'object' ? data : { data }),
            QueueUrl: this.endpoint(),
        };
        _log(NS, `> params[${this.endpoint()}] =`, $U.json(params));

        const sqs = new AWS.SQS({ region: this.region() });
        const result = await sqs.sendMessage(params).promise();
        _log(NS, '> result =', result);
        return (result && result.MessageId) || '';
    }

    /**
     * receive message by size.
     *
     * @param size      (default 1) size of message
     */
    public async receiveMessage(size: number = 1): Promise<{ list: SqsMessage[] }> {
        size = size === undefined ? 1 : size;
        size = $U.N(size, 0);
        if (!size) throw new Error('@size(number) is required!');

        //! prepare param.
        const params: SQS.Types.ReceiveMessageRequest = {
            AttributeNames: ['SentTimestamp'],
            MaxNumberOfMessages: size,
            MessageAttributeNames: ['All'],
            QueueUrl: this.endpoint(),
            // VisibilityTimeout: 0,				//WARN! DUPLICATE MESSAGES CAN BE SEEN.
            WaitTimeSeconds: 0, //WARN! WAIT FOR EMPTY QUEUE.
        };
        _log(NS, `> params[${this.endpoint()}] =`, $U.json(params));

        //! call api
        const sqs = new AWS.SQS({ region: this.region() });
        const result = await sqs.receiveMessage(params).promise();
        _log(NS, '> result =', $U.json(result));

        //! transform list.
        const list: SqsMessage[] = (result && result.Messages).map(_ => {
            const N: any = {};
            N.sent = _.Attributes.SentTimestamp;
            const $attr = _.MessageAttributes || {};
            N.attr = Object.keys($attr).reduce((O: any, key: string) => {
                const V = $attr[key];
                const type = (V && V.DataType) || '';
                const val = (V && V.StringValue) || '';
                O[key] = type == 'Number' ? Number(val) : val;
                return O;
            }, {});
            N.data = JSON.parse(_.Body || '{}');
            N.id = _.MessageId;
            N.handle = _.ReceiptHandle;
            return N;
        });

        //! returns.
        return { list };
    }

    /**
     * delete message by id
     * @param handle        handle-id to delete.
     */
    public async deleteMessage(handle: string): Promise<void> {
        if (!handle) throw new Error('@handle(string) is required!');

        //! prepare param
        const params = {
            QueueUrl: this.endpoint(),
            ReceiptHandle: handle,
        };
        _log(NS, `> params[${this.endpoint()}] =`, $U.json(params));

        //! call delete.
        const sqs = new AWS.SQS({ region: this.region() });
        const result = await sqs.deleteMessage(params).promise();
        _log(NS, '> result =', $U.json(result));
        return;
    }

    /**
     * statistics for the given type.
     *
     * @param {*} TYPE
     */
    public async statistics(): Promise<SqsStatistics> {
        const params = {
            QueueUrl: this.endpoint(),
            AttributeNames: ['All'],
        };
        _log(NS, `> params[${this.endpoint()}] =`, $U.json(params));

        //! call delete.
        const sqs = new AWS.SQS({ region: this.region() });
        const result = await sqs.getQueueAttributes(params).promise();
        _log(NS, '> result =', $U.json(result));
        const attr = result.Attributes || {};
        const stat: SqsStatistics = {
            available: $U.N(attr.ApproximateNumberOfMessages, 0),
            inflight: $U.N(attr.ApproximateNumberOfMessagesNotVisible, 0),
            delayed: $U.N(attr.ApproximateNumberOfMessagesDelayed, 0),
            timeout: $U.N(attr.VisibilityTimeout, 0),
        };

        //! returns finally.
        return stat;
    }
}

/** ****************************************************************************************************************
 *  Dummy SQS Service
 ** ****************************************************************************************************************/
/**
 * class: MyDummySQSService
 * - simulated dummy `SQSService` which is identical to real-service.
 */
export class MyDummySQSService implements SQSService {
    private buffer: SqsMessage[] = [];
    private endpoint: string;
    private timeout: number;
    public constructor(endpoint: string, timeout: number = 30) {
        _log(NS, `MyDummySQSService(${endpoint}, ${timeout})...`);
        this.endpoint = endpoint;
        this.timeout = timeout;
    }
    public hello = () => `dummy-sqs-service:${this.endpoint}`;
    public async sendMessage(data: any, attr?: SQSAttribute): Promise<string> {
        if (!data) throw new Error('@data(object) is required!');
        const fn = (n: number): string => {
            const [S, s] = ['ff2cb2000000', `${n}`];
            return n > 0 ? `${S.substring(s.length)}${s}` : s.startsWith('-') ? `N${s.substring(1)}` : s;
        };
        const payload: SqsMessage = { sent: new Date().getTime(), attr, data, id: '', handle: '' };
        this.buffer.push(payload);
        const len = this.buffer.length;
        const id = `aabbccdd-dummy-sqs-b29b-${fn(len)}`;
        _inf(NS, `> queue[${id}] :=`, $U.json(payload));
        if (this.timeout > 0) {
            setTimeout(() => {
                payload.id = id;
            }, this.timeout);
        } else if (this.timeout == 0) {
            payload.id = id;
        }
        return id;
    }
    public async receiveMessage(size?: number): Promise<{ list: SqsMessage[] }> {
        size = size === undefined ? 1 : size;
        const list = this.buffer.filter(data => (data.id && data.data ? true : false));
        const list2 = list
            .filter((_data, index) => index < size)
            .map(data => {
                const data2 = { ...data }; // copy
                data2.handle = `${data.id}`;
                data.id = ''; // mark received.
                return data2;
            });
        return { list: list2 };
    }
    public async deleteMessage(handle: string): Promise<void> {
        this.buffer.filter(data => data.handle == handle).map(data => delete data.data);
    }
    public async statistics(): Promise<SqsStatistics> {
        const available = this.buffer.filter(data => !!data.id).length;
        const inflight = 0;
        const delayed = 0;
        const timeout = this.timeout;
        return { available, inflight, delayed, timeout };
    }
}
