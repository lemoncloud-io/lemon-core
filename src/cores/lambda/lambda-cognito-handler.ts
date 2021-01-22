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
import { $engine, _log, _inf, _err, $U, $_ } from '../../engine/';
import { LambdaHandler, CognitoHandler, LambdaSubHandler } from './lambda-handler';
const NS = $U.NS('HCOG', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: LambdaCognitoHandler
 * - default COGNITO Handler w/ event-listeners.
 */
export class LambdaCognitoHandler extends LambdaSubHandler<CognitoHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'cognito' : undefined);
        // _log(NS, `LambdaCognitoHandler()..`);
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
