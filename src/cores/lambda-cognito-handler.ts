/**
 * `lambda-cognito-handler.ts`
 * - lambda handler to process COGNITO event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U, $_ } from '../engine/';
const NS = $U.NS('HCOG', 'yellow'); // NAMESPACE TO BE PRINTED.

import $lambda, { LambdaHandler, CognitoHandler, LambdaHandlerService } from './lambda-handler';

/**
 * class: LambdaCognitoHandler
 * - default COGNITO Handler w/ event-listeners.
 */
export class LambdaCognitoHandler implements LambdaHandlerService<CognitoHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    protected constructor(lambda: LambdaHandler, register?: boolean) {
        _log(NS, `LambdaCognitoHandler()..`);
        if (register) {
            lambda.setHandler('cognito', this);
        }
    }

    public addListener() {}

    /**
     * Default COGNITO Handler.
     */
    public handle: CognitoHandler = async (event): Promise<any> => {
        //! for each records.
        _log(NS, `handle()...`);
        _log(NS, '> event =', $U.json(event));
    };
}

/**
 * class: `LambdaCognitoHandlerMain`
 * - default implementations.
 */
class LambdaCognitoHandlerMain extends LambdaCognitoHandler {
    public constructor() {
        super($lambda, true);
    }
}

//! create instance & export as default.
const $instance: LambdaCognitoHandler = new LambdaCognitoHandlerMain();
export default $instance;
