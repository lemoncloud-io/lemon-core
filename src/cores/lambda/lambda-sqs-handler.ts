/**
 * `lambda-sqs-handler.ts`
 * - lambda handler to process SQS event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 * @date        2026-10-30 v5 B14: the receiver's own ids (`packContext()`) for a relay; channel `internal`.
 * @date        2026-10-30 v5 B14: a same-service callback advances `trace.hop` (cap `PROTOCOL_MAX_HOP`), `depth` in sync.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err, do_parrallel } from '../../engine/';
import { SQSRecord, Context } from 'aws-lambda';
import { SQSHandler, LambdaHandler, LambdaSubHandler, buildReportError } from './lambda-handler';
import { NextHandler, NextContext } from 'lemon-model';
import { MyProtocolParam } from '../protocol/protocol-service';
import $protocol from '../protocol/';
import { ATTR_PROTOCOL_SIGNATURE, assertSigned, verifyMessage } from '../protocol/protocol-sign';
import { accountOfArn, nextHopContext, logTrace } from '../protocol/protocol-relay';
const NS = $U.NS('HSQS', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: LambdaSQSHandler
 * - default SQS Handler w/ event-listeners.
 */
export class LambdaSQSHandler extends LambdaSubHandler<SQSHandler> {
    //* shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'sqs' : undefined);
        // _log(NS, `LambdaSQSHandler()..`);
    }

    protected listeners: NextHandler[] = [];
    public addListener(handler: NextHandler) {
        this.listeners.push(handler);
    }

    //* for debugging. save last result
    protected $lastResult: any = null;

    /**
     * v5 B14: the receiver's own ids of this invocation (the relay context uses them, D2).
     * - `requestId` = Lambda `awsRequestId`, `accountId` = the account of `invokedFunctionArn` (12 digits).
     */
    public async packContext(event: any, context: Context): Promise<NextContext> {
        const own: NextContext = {};
        if (context?.awsRequestId) own.requestId = `${context.awsRequestId}`;
        const accountId = accountOfArn(context?.invokedFunctionArn);
        if (accountId) own.accountId = accountId;
        return own;
    }

    /**
     * Default SQS Handler.
     * - v5 B5: never rejects. a failed record goes to `batchItemFailures` (by `messageId`).
     */
    public handle: SQSHandler = async (event, $ctx): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> => {
        //* for each records.
        const records: SQSRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        // _log(NS, '> event =', $U.json(event));
        const $doReportError = buildReportError(LambdaSQSHandler.REPORT_ERROR);
        //* v5: indexes of the failed records (listener, protocol or signature failure).
        const failed = new Set<number>();
        //* mark the record as failed, then report (resolves the error message).
        const $fail = (index: number) => (e: any, context?: any, event?: any, data?: any) => {
            failed.add(index);
            return $doReportError(e, context, event, data);
        };

        //* handle sqs record data.
        const onSQSRecord = async (record: SQSRecord, index: number): Promise<string> => {
            _log(NS, `onSQSRecord(${(record && record.messageId) || ''}, ${index})...`);

            //* retrieve message-attributes as `param`
            const param = Object.keys(record.messageAttributes || {}).reduce((O: any, key: string) => {
                const V = record.messageAttributes[key];
                if (!V) return O;
                const type = V.dataType || '';
                const val = V.stringValue || '';
                O[key] = type == 'Number' ? Number(val) : val;
                return O;
            }, {});

            //* check if via protocol-service.
            if (param['Subject'] && param['Subject'] == 'x-protocol-service') {
                //* v5 B5: verify the signature before dispatch (`enforce` → this record fails).
                const signature = `${record.messageAttributes?.[ATTR_PROTOCOL_SIGNATURE]?.stringValue ?? ''}`;
                assertSigned('sqs', () => verifyMessage(signature, record.body));
                //* v5 B14: own ids — the invocation's, else the message id and the queue account.
                const own: NextContext = {
                    requestId: `${$ctx?.requestId || record.messageId || ''}` || undefined,
                    accountId: `${$ctx?.accountId || accountOfArn(record.eventSourceARN) || ''}` || undefined,
                };
                const param: MyProtocolParam = $protocol.service.asTransformer('sqs').transformToParam(record, own);
                const context: NextContext = param.context;
                const callback = param.callback || '';
                const result = await this.lambda
                    .handleProtocol(param)
                    .then(body => {
                        // _log(NS, `! res[${index}] =`, $U.json(body));
                        callback && _log(NS, `> callback[${index}] =`, callback); // ex) api://lemon-queue-api-dev/batch/test11/callback#2.2.1
                        context && _log(NS, `> context[${index}] =`, $U.json(context)); // ex) {"source":"express","domain":"localhost"}
                        //* report call back.
                        const proto = callback ? $protocol.service.fromURL(context, callback, null, body || {}) : null;
                        proto && _log(NS, `> protocol[${index}] =`, $U.json(proto));
                        _log(NS, `> config.service =`, this.lambda.config && this.lambda.config.getService());
                        //* check if service is in same..
                        if (proto && this.lambda.config && proto.service == this.lambda.config.getService()) {
                            //* v5 B14: an in-process next hop — hop + 1 (cap → 508), same tid, via/pid of this receiver.
                            proto.context = nextHopContext(proto.context, $protocol.service.myProtocolURI(context));
                            logTrace(proto.context);
                            proto.body = body;
                            _log(NS, `! body[${index}] =`, $U.json(body));
                            return this.lambda.handleProtocol(proto).then(body => {
                                _log(NS, `>> body[${index}].callback =`, $U.json(body));
                                return body;
                            });
                        }
                        //* call the remote service if callback.
                        return proto ? $protocol.service.execute(proto) : body;
                    })
                    .catch(e => $fail(index)(e, param.context, null, { protocol: param }));
                _log(NS, `> sqs[${index}].res =`, $U.json(result));
                return typeof result == 'string' ? result : $U.json(result);
            } else {
                //* load data as `body`
                const body =
                    typeof record.body == 'string' && record.body.startsWith('{') && record.body.endsWith('}')
                        ? JSON.parse(record.body)
                        : { data: record.body };
                _log(NS, `> sqs[${index}].param =`, $U.json(param));
                _log(NS, `> sqs[${index}].body =`, $U.json(body));

                //* call all listeners in parrallel.
                const asyncNext = (fn: NextHandler, j: number) =>
                    new Promise(resolve => {
                        resolve(fn('SQS', param, body, null));
                    }).catch(e => $fail(index)(e, null, null, { param, body, i: index, j }));
                const res = await Promise.all(this.listeners.map(asyncNext));
                return res.join(',');
            }
        };

        //* serialize each records.
        this.$lastResult = await do_parrallel(
            records,
            (record, i) => onSQSRecord(record, i).catch(e => $fail(i)(e, null, null, { record, i })),
            1,
        );

        //* v5: returns the partial batch response (empty if all succeeded).
        const batchItemFailures = records
            .filter((_, i) => failed.has(i))
            .map(record => ({ itemIdentifier: `${record?.messageId ?? ''}` }));
        return { batchItemFailures };
    };
}
