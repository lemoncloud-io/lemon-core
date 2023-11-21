/**
 * `aws-sqs-service.ts`
 * - sqs service for AWS `SQS`.
 *
 *
 * //TODO - move to `lemon-core` shared lib.
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-25 initial azure service bus queues service
 * 
 * @copyright   (C) lemoncloud.io 2023 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U } from '../../engine';
import { CoreServices } from '../core-services';
import { KeyVaultService } from '../azure'
import 'dotenv/config'

const NS = $U.NS('AZQU', 'blue'); // NAMESPACE TO BE PRINTED.

/**
 * interface: SQSService
 * - common interface type for `SQS`
 */
export interface SQSService extends CoreServices {
    sendMessage(data: any, attr?: SQSAttribute): Promise<string>;
    receiveMessage(size?: number): Promise<{ list: SqsMessage[] }>;
    deleteMessage(handle: any): Promise<void>;
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
 * class: AZSbQueueService
 * - support of AWS `SQS` Service
 */
export class QueuesService implements SQSService {
    public static SB_QUEUES_ENDPOINT = 'queue-lemon';

    protected _region: string;
    protected _endpoint: string;
    protected $kv: KeyVaultService;

    /**
     * default constructor.
     */
    public constructor(endpoint?: string, region?: string) {
        endpoint = endpoint || ($engine.environ(QueuesService.SB_QUEUES_ENDPOINT, '') as string) || '';
        endpoint = process.env.AZ_QUEUE_NAME ?? endpoint
        // const stage = $engine.environ('STAGE', '') as string;
        // if (!endpoint && stage != 'local')
        //     throw new Error(`env.${QueuesService.SB_QUEUES_ENDPOINT} is required w/ stage:${stage}`);
        _log(NS, `QueuesService(${endpoint}, ${region})...`);
        this._region = region;
        this._endpoint = endpoint;
    }
    public region(): string {
        return this._region;
    }
    public endpoint(): string {
        return this._endpoint;
    }
    public iso8601DurationToSeconds(durationString: any) {
        const matches = durationString.match(/^PT(\d+)M$/);
        if (matches) {
            const mins = parseInt(matches[1], 10);
            return mins * 60;
        } else {
            throw new Error('Invalid ISO 8601 duration format');
        }
    }
    public static $kv: KeyVaultService = new KeyVaultService();
    public instance = async () => {
        const { ServiceBusClient, ServiceBusAdministrationClient } = require("@azure/service-bus");
        const connectionString = await QueuesService.$kv.decrypt(process.env.AZ_SB_CONNECTION_STRING)
        const serviceBusClient = new ServiceBusClient(connectionString);
        const serviceBusAdministrationClient = new ServiceBusAdministrationClient(connectionString);
        return { serviceBusClient, serviceBusAdministrationClient }
    };
    /**
     * hello
     */
    public hello = () => `az-sb-queues-service:${this._endpoint || ''}`;

    /**
     * send message into SQS.
     *
     * @param data      object data to be json.
     * @param attr      attribute set.
     */
    public async sendMessage(data: any): Promise<any> {
        if (!data) throw new Error('@data(object) is required!');
        const { serviceBusClient } = await this.instance();
        const sender = serviceBusClient.createSender(this._endpoint);
        const messages = [{
            contentType: "application/json",
            body: data,
        }]

        let batch = await sender.createMessageBatch();
        for (const message of messages) {
            if (!batch.tryAddMessage(message)) {
                // Send the current batch as it is full and create a new one
                await sender.sendMessages(batch);
                batch = await sender.createMessageBatch();

                if (!batch.tryAddMessage(message)) {
                    throw new Error("Message too big to fit in a batch");
                }
            }
        }

        await sender.sendMessages(batch)
        await sender.close();

        return;
    }

    /**
     * receive message by size.
     *
     * @param size      (default 1) size of message
     */
    public async receiveMessage(size: number = 1): Promise<any> {
        size = size === undefined ? 1 : size;
        size = $U.N(size, 0);

        if (!size) throw new Error('@size(number) is required!');
        const { serviceBusClient } = await this.instance();
        const receiver = await serviceBusClient.createReceiver(this._endpoint);
        const messages = await receiver.receiveMessages(size); //  it defaults to the "peekLock" mode

        const list = [];
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            try {
                list.push(message);
            } catch (error) {
                console.error("Error occurred:", error);
                await receiver.abandonMessage(message); // If an error occurs, return the message back to the queue
            }
            return { list }
        }
    }
    /**
     * delete message by id
     * @param handle        handle-id to delete.
     */
    public async deleteMessage(message: any): Promise<void> {
        if (!message) throw new Error('@handle(string) is required!');
        const { serviceBusClient } = await this.instance();
        const receiver = await serviceBusClient.createReceiver(this._endpoint);
        await receiver.completeMessage(message);     // Process the message and delete it
        return
    }

    /**
     * statistics for the given type.
     *
     * @param {*} TYPE
     */
    public async statistics(): Promise<SqsStatistics> {
        const { serviceBusAdministrationClient } = await this.instance();
        const queueProperties = await serviceBusAdministrationClient.getQueue(this._endpoint)
        const queueRuntimeProperties = await serviceBusAdministrationClient.getQueueRuntimeProperties(this._endpoint)

        // The number of active messages in the entity.
        // If a message is successfully delivered to a subscription, 
        // the number of active messages in the topic itself is 0.
        const available = queueRuntimeProperties.activeMessageCount

        const inflight = queueRuntimeProperties.totalMessageCount - queueRuntimeProperties.activeMessageCount

        //The number of messages which are yet to be transferred/forwarded to destination entity.
        const delayed = queueRuntimeProperties.transferMessageCount // Delayed

        //The number of messages transfer-messages which are dead-lettered into transfer-dead-letter subqueue.
        const timeout = this.iso8601DurationToSeconds(queueProperties.lockDuration)// Timeout

        return { available, inflight, delayed, timeout };
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