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
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('HSNS', 'yellow'); // NAMESPACE TO BE PRINTED.

import { SNSEventRecord } from 'aws-lambda';
import $lambda, { LambdaHandler, SNSHandler, LambdaHandlerService } from './lambda-handler';

/**
 * class: LambdaSNSHandler
 * - default SNS Handler w/ event-listeners.
 */
export class LambdaSNSHandler implements LambdaHandlerService<SNSHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    protected constructor(lambda: LambdaHandler, register?: boolean) {
        _log(NS, `LambdaSNSHandler()..`);
        if (register) {
            lambda.setHandler('sns', this);
        }
    }

    public addListener() {}

    /**
     * Default SNS Handler.
     */
    public handle: SNSHandler = async (event): Promise<void> => {
        //! for each records.
        const records: SNSEventRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        _log(NS, '> event =', $U.json(event));
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
