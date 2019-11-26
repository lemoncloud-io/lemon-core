/**
 * `lambda-sqs-handler.ts`
 * - lambda handler to process SQS event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('HSQS', 'yellow'); // NAMESPACE TO BE PRINTED.
import { doReportError, do_parrallel } from '../engine/';

import { SQSRecord } from 'aws-lambda';
import $lambda, { SQSHandler, LambdaHandler, LambdaHandlerService } from './lambda-handler';

/**
 * class: LambdaSQSHandler
 * - default SQS Handler w/ event-listeners.
 */
export class LambdaSQSHandler implements LambdaHandlerService<SQSHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    protected constructor(lambda: LambdaHandler, register?: boolean) {
        _log(NS, `LambdaSQSHandler()..`);
        if (register) {
            lambda.setHandler('sqs', this);
        }
    }

    public addListener() {}

    /**
     * Default SQS Handler.
     */
    public handle: SQSHandler = async (event, context): Promise<void> => {
        //! for each records.
        const records: SQSRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        _log(NS, '> event =', $U.json(event));

        //! handle sqs record data.
        const sqsOnRecord = async (record: SQSRecord, index: number): Promise<string | boolean> => {
            _log(NS, `sqsOnRecord(${(record && record.messageId) || ''}, ${index})...`);

            //! retrieve message-attributes as `param`
            const param = Object.keys(record.messageAttributes).reduce((O: any, key: string) => {
                const V = record.messageAttributes[key];
                if (!V) return O;
                const type = V.dataType || '';
                const val = V.stringValue || '';
                O[key] = type == 'Number' ? Number(val) : val;
                return O;
            }, {});
            _log(NS, '> param =', $U.json(param));

            //! load data as `body`
            const body =
                typeof record.body == 'string' && record.body.startsWith('{') && record.body.endsWith('}')
                    ? JSON.parse(record.body)
                    : { data: record.body };
            _log(NS, '> body =', $U.json(body));

            //! decode function.
            const safeCall = async (param: any, body: any): Promise<string> => {
                if (body && body.hello == 'sample') return sqsRegisterSample(); //NOTE - test for internal sqs:sendMessage()
                // if (body && body.hello == 'error') return sqsOnTicketQueue(null); //NOTE - test for internal error-report.
                // if (attr.source == 'ticket-queue-service') return sqsOnTicketQueue(data); //NOTE - forward to ticket-service.
                return 'N/A';
            };

            //! default return true;
            return await safeCall(param, body).catch(async (e: Error) => {
                if (!LambdaSQSHandler.REPORT_ERROR) return `${e.message}`;
                return doReportError(e, context, null, { from: 'sqsOnRecord', attr: param, data: body })
                    .catch(() => '')
                    .then(() => `${e.message}`);
            });
        };

        //! register sample sqs message of ticket.
        const sqsRegisterSample = async (): Promise<string> => {
            _log(NS, `sqsRegisterSample()...`);
            // const $handler = new (class implements TicketQueueHandleable {
            //     // eslint-disable-next-line prettier/prettier
            //             public async handleQueue(ticketId: string, event?: TicketEvent, ticket?: TicketModel): Promise<TicketModel> {
            //         _log(NS, `handleQueue(${ticketId})...`);
            //         _log(NS, '> event =', $U.json(event));
            //         _log(NS, '> ticket =', $U.json(ticket));
            //         return ticket;
            //     }
            // })();
            // const sqs = new AWSSQSService();
            // const que = new MyTicketQueueSQSService($handler, sqs);
            // const ticket: TicketModel = { id: 'test-ticket' };
            // const event: TicketEvent = { id: 'event-001', transactionId: '', status: 'sender-error' };
            // const qid = await que.queTicket(ticket, event);
            // return qid;
            return 'N/A';
        };

        //! serialize each records.
        await do_parrallel(records, sqsOnRecord, 1);
    };
}

/**
 * class: `LambdaSQSHandlerMain`
 * - default implementations.
 */
class LambdaSQSHandlerMain extends LambdaSQSHandler {
    public constructor() {
        super($lambda, true);
    }
}

//! create instance & export as default.
const $instance: LambdaSQSHandler = new LambdaSQSHandlerMain();
export default $instance;
