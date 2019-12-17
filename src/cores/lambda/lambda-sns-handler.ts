/**
 * `lambda-sns-handler.ts`
 * - lambda handler to process SNS event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, $_, do_parrallel, doReportError } from '../../engine/';
const NS = $U.NS('HSNS', 'yellow'); // NAMESPACE TO BE PRINTED.

import { SNSEventRecord, SNSMessage } from 'aws-lambda';
import { NextContext, NextHandler } from './../core-services';
import { LambdaHandler, SNSHandler, LambdaSubHandler } from './lambda-handler';
import { MyProtocolParam } from '../protocol/protocol-service';
import $protocol from '../protocol/';

/**
 * class: LambdaSNSHandler
 * - default SNS Handler w/ event-listeners.
 */
export class LambdaSNSHandler extends LambdaSubHandler<SNSHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'sns' : undefined);
        _log(NS, `LambdaSNSHandler()..`);
    }

    protected listeners: NextHandler[] = [];
    public addListener(handler: NextHandler) {
        this.listeners.push(handler);
    }

    //! for debugging. save last result
    protected $lastResult: any = null;

    /**
     * Default SNS Handler.
     */
    public handle: SNSHandler = async (event): Promise<void> => {
        //! for each records.
        const records: SNSEventRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        _log(NS, '> event =', $U.json(event));

        //! handle sqs record data.
        const onSNSRecord = async (record: SNSEventRecord, index: number): Promise<string | boolean> => {
            _log(NS, `onSNSRecord(${(record && record.EventSource) || ''}, ${index})...`);

            //! check if via protocol-service.
            const $msg: SNSMessage = record.Sns;
            const { Subject } = $msg;
            if (Subject == 'x-protocol-service') {
                const param: MyProtocolParam = $protocol.service.asTransformer('sns').transformToParam($msg);
                const context: NextContext = param.context;
                const callback = param.callback || '';
                const result = await this.lambda
                    .handleProtocol(param)
                    .then(body => {
                        // _log(NS, `! res[${index}] =`, $U.json(body));
                        const proto = callback ? $protocol.service.fromURL(context, callback, null, body || {}) : null;
                        return proto ? $protocol.service.execute(proto) : body;
                    })
                    .catch(e => {
                        doReportError(e, param.context, null, { protocol: param });
                        throw e;
                    });
                _log(NS, `> sns[${index}].res =`, $U.json(result));
                return true;
            } else {
                //! retrieve message-attributes as `param`
                const param = Object.keys($msg.MessageAttributes || {}).reduce(
                    (O: any, key: string) => {
                        const V = $msg.MessageAttributes[key];
                        if (!V) return O;
                        O[key] = V.Type == 'Number' ? Number(V.Value) : V.Value;
                        return O;
                    },
                    { subject: Subject }, //NOTE! - should have 'subject' property.
                );
                //! load data as `body`
                const body =
                    typeof $msg.Message == 'string' && $msg.Message.startsWith('{') && $msg.Message.endsWith('}')
                        ? JSON.parse($msg.Message)
                        : { data: $msg.Message };
                _log(NS, `> sns[${index}].param =`, $U.json(param));
                _log(NS, `> sns[${index}].body =`, $U.json(body));

                //! process for each listeners.
                const res: string[] = await Promise.all(
                    this.listeners.map((h, i) =>
                        h(`SNS`, param, body, null)
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
        };

        //! serialize each records.
        this.$lastResult = await do_parrallel(records, onSNSRecord, 5);

        //! returns.
        return;
    };
}
