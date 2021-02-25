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
import { _log, _inf, _err, $U, do_parrallel } from '../../engine/';
import { SQSRecord } from 'aws-lambda';
import { SQSHandler, LambdaHandler, LambdaSubHandler, buildReportError } from './lambda-handler';
import { NextHandler, NextContext } from './../core-services';
import { MyProtocolParam } from '../protocol/protocol-service';
import $protocol from '../protocol/';
const NS = $U.NS('HSQS', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: LambdaSQSHandler
 * - default SQS Handler w/ event-listeners.
 */
export class LambdaSQSHandler extends LambdaSubHandler<SQSHandler> {
    //! shared config.
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

    //! for debugging. save last result
    protected $lastResult: any = null;

    /**
     * Default SQS Handler.
     */
    public handle: SQSHandler = async (event): Promise<void> => {
        //! for each records.
        const records: SQSRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        // _log(NS, '> event =', $U.json(event));
        const $doReportError = buildReportError(LambdaSQSHandler.REPORT_ERROR);

        //! handle sqs record data.
        const onSQSRecord = async (record: SQSRecord, index: number): Promise<string> => {
            _log(NS, `onSQSRecord(${(record && record.messageId) || ''}, ${index})...`);

            //! retrieve message-attributes as `param`
            const param = Object.keys(record.messageAttributes || {}).reduce((O: any, key: string) => {
                const V = record.messageAttributes[key];
                if (!V) return O;
                const type = V.dataType || '';
                const val = V.stringValue || '';
                O[key] = type == 'Number' ? Number(val) : val;
                return O;
            }, {});

            //! check if via protocol-service.
            if (param['Subject'] && param['Subject'] == 'x-protocol-service') {
                const param: MyProtocolParam = $protocol.service.asTransformer('sqs').transformToParam(record);
                const context: NextContext = param.context;
                const callback = param.callback || '';
                const result = await this.lambda
                    .handleProtocol(param)
                    .then(body => {
                        // _log(NS, `! res[${index}] =`, $U.json(body));
                        callback && _log(NS, `> callback[${index}] =`, callback); // ex) api://lemon-queue-api-dev/batch/test11/callback#2.2.1
                        context && _log(NS, `> context[${index}] =`, $U.json(context)); // ex) {"source":"express","domain":"localhost"}
                        //! report call back.
                        const proto = callback ? $protocol.service.fromURL(context, callback, null, body || {}) : null;
                        proto && _log(NS, `> protocol[${index}] =`, $U.json(proto));
                        _log(NS, `> config.service =`, this.lambda.config && this.lambda.config.getService());
                        //! check if service is in same..
                        if (proto && this.lambda.config && proto.service == this.lambda.config.getService()) {
                            proto.context.depth = $U.N(proto.context.depth, 1) + 1;
                            proto.body = body;
                            _log(NS, `! body[${index}] =`, $U.json(body));
                            return this.lambda.handleProtocol(proto).then(body => {
                                _log(NS, `>> body[${index}].callback =`, $U.json(body));
                                return body;
                            });
                        }
                        //! call the remote service if callback.
                        return proto ? $protocol.service.execute(proto) : body;
                    })
                    .catch(e => $doReportError(e, param.context, null, { protocol: param }));
                _log(NS, `> sqs[${index}].res =`, $U.json(result));
                return typeof result == 'string' ? result : $U.json(result);
            } else {
                //! load data as `body`
                const body =
                    typeof record.body == 'string' && record.body.startsWith('{') && record.body.endsWith('}')
                        ? JSON.parse(record.body)
                        : { data: record.body };
                _log(NS, `> sqs[${index}].param =`, $U.json(param));
                _log(NS, `> sqs[${index}].body =`, $U.json(body));

                //! call all listeners in parrallel.
                const asyncNext = (fn: NextHandler, j: number) =>
                    new Promise(resolve => {
                        resolve(fn('SQS', param, body, null));
                    }).catch(e => $doReportError(e, null, null, { param, body, i: index, j }));
                const res = await Promise.all(this.listeners.map(asyncNext));
                return res.join(',');
            }
        };

        //! serialize each records.
        this.$lastResult = await do_parrallel(
            records,
            (record, i) => onSQSRecord(record, i).catch(e => $doReportError(e, null, null, { record, i })),
            1,
        );

        //! returns void.
        return;
    };
}
