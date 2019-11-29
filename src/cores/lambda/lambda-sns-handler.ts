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
import { $engine, _log, _inf, _err, $U, $_, do_parrallel, doReportError } from '../../engine/';
const NS = $U.NS('HSNS', 'yellow'); // NAMESPACE TO BE PRINTED.

import { SNSEventRecord, SNSMessage } from 'aws-lambda';
import $lambda, { LambdaHandler, SNSHandler, LambdaHandlerService } from './lambda-handler';
import { ProtocolParam } from './../';
import $protocol from './../protocol-service';

/**
 * class: LambdaSNSHandler
 * - default SNS Handler w/ event-listeners.
 */
export class LambdaSNSHandler implements LambdaHandlerService<SNSHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;
    private lambda: LambdaHandler = null;

    /**
     * default constructor w/ registering self.
     */
    protected constructor(lambda: LambdaHandler, register?: boolean) {
        _log(NS, `LambdaSNSHandler()..`);
        this.lambda = lambda;
        if (register) lambda.setHandler('sns', this);
    }

    public addListener() {}

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
                const param: ProtocolParam = $protocol.sns.transformToParam($msg);
                const result = await this.lambda.handleProtocol(param).catch(e => {
                    doReportError(e, param.context, null, { protocol: param });
                    throw e;
                });
                _log(NS, `> sns[${index}].res =`, $U.json(result));
                return true;
            } else {
                //! retrieve message-attributes as `param`
                const param = Object.keys($msg.MessageAttributes).reduce((O: any, key: string) => {
                    const V = $msg.MessageAttributes[key];
                    if (!V) return O;
                    O[key] = V.Type == 'Number' ? Number(V.Value) : V.Value;
                    return O;
                }, {});
                //! load data as `body`
                const body =
                    typeof $msg.Message == 'string' && $msg.Message.startsWith('{') && $msg.Message.endsWith('}')
                        ? JSON.parse($msg.Message)
                        : { data: $msg.Message };
                _log(NS, `> sns[${index}].param =`, $U.json(param));
                _log(NS, `> sns[${index}].body =`, $U.json(body));
            }

            // or returns false.
            return false;
        };

        //! serialize each records.
        this.$lastResult = await do_parrallel(records, onSNSRecord, 5);

        //! returns.
        return;
    };
}

/**
 * class: `LambdaSNSHandlerMain`
 * - default implementations.
 */
class LambdaSNSHandlerMain extends LambdaSNSHandler {
    public constructor() {
        super($lambda, true);
    }
}

//! create instance & export as default.
const $instance: LambdaSNSHandler = new LambdaSNSHandlerMain();
export default $instance;
