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
import { _log, _inf, _err, $U, $_ } from '../../engine/';
const NS = $U.NS('HSQS', 'yellow'); // NAMESPACE TO BE PRINTED.
import { doReportError, do_parrallel } from '../../engine/';

import { SQSRecord } from 'aws-lambda';
import { SQSHandler, LambdaHandler, LambdaSubHandler } from './lambda-handler';
import { NextHandler, NextContext } from './../core-services';
import { MyProtocolParam } from '../protocol/protocol-service';
import $protocol from '../protocol/';

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
        _log(NS, `LambdaSQSHandler()..`);
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
    public handle: SQSHandler = async (event, context): Promise<void> => {
        //! for each records.
        const records: SQSRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        _log(NS, '> event =', $U.json(event));

        //! handle sqs record data.
        const onSQSRecord = async (record: SQSRecord, index: number): Promise<string | boolean> => {
            _log(NS, `sqsOnRecord(${(record && record.messageId) || ''}, ${index})...`);

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
                        const proto = callback ? $protocol.service.fromURL(context, callback, null, body || {}) : null;
                        proto && _log(NS, `> protocol[${index}] =`, $U.json(proto));
                        return proto ? $protocol.service.execute(proto) : body;
                    })
                    .catch(e => {
                        doReportError(e, param.context, null, { protocol: param });
                        throw e;
                    });
                _log(NS, `> sns[${index}].res =`, $U.json(result));
                return true;
            } else {
                //! load data as `body`
                const body =
                    typeof record.body == 'string' && record.body.startsWith('{') && record.body.endsWith('}')
                        ? JSON.parse(record.body)
                        : { data: record.body };
                _log(NS, `> sqs[${index}].param =`, $U.json(param));
                _log(NS, `> sqs[${index}].body =`, $U.json(body));

                //! process for each listeners.
                const res: string[] = await Promise.all(
                    this.listeners.map((h, i) =>
                        h(`SQS`, param, body, null)
                            .then(_ => {
                                _log(NS, `>> [${i}].res =`, $U.json(_));
                                return `${i}`;
                            })
                            .catch((e: Error) => {
                                doReportError(e, null, null, { i, param, body });
                                return `ERR[${i}] - ${e.message}`;
                            }),
                    ),
                );
                //! concont
                return res.join(',');
            }

            return false;
        };

        //! serialize each records.
        this.$lastResult = await do_parrallel(records, onSQSRecord, 1);

        //! returns void.
        return;
    };
}
