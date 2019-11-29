/**
 * `lambda-wss-handler.ts`
 * - lambda handler to process WSS event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U, $_ } from '../../engine/';
const NS = $U.NS('HWSS', 'yellow'); // NAMESPACE TO BE PRINTED.

import { APIGatewayProxyResult } from 'aws-lambda';
import $lambda, { LambdaHandler, WSSHandler, LambdaHandlerService } from './lambda-handler';

/** ********************************************************************************************************************
 *  COMMON Functions.
 ** ********************************************************************************************************************/
export const buildResponse = (statusCode: number, body: any): APIGatewayProxyResult => {
    // @0612 - body 가 string일 경우, 응답형식을 텍스트로 바꿔서 출력한다.
    return {
        statusCode,
        headers: {
            'Content-Type':
                typeof body === 'string'
                    ? body.startsWith('<') && body.endsWith('>')
                        ? 'text/html; charset=utf-8'
                        : 'text/plain; charset=utf-8'
                    : 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*', // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    };
};

export const success = (body: any) => {
    return buildResponse(200, body);
};

export const notfound = (body: any) => {
    return buildResponse(404, body);
};

export const failure = (body: any) => {
    return buildResponse(503, body);
};

/**
 * class: LambdaWSSHandler
 * - default WSS Handler w/ event-listeners.
 */
export class LambdaWSSHandler implements LambdaHandlerService<WSSHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    protected constructor(lambda: LambdaHandler, register?: boolean) {
        _log(NS, `LambdaWSSHandler()..`);
        if (register) {
            lambda.setHandler('wss', this);
        }
    }

    public addListener() {}

    /**
     * Default WSS Handler.
     *
     * example:
     * ```js
     * $ npm install -g wscat
     * $ wscat -c wss://6ye6t5py3i.execute-api.ap-northeast-2.amazonaws.com/dev
     * > {"action":"echo"}
     * ```
     */
    public handle: WSSHandler = async (event): Promise<any> => {
        //! for each records.
        _log(NS, `handle()...`);
        _log(NS, '> event =', $U.json(event));

        const $req = event.requestContext;
        const EVENT_TYPE = $req.eventType || '';
        const ROUTE_KEY = $req.routeKey || '';
        _log(NS, `> route(${ROUTE_KEY}/${EVENT_TYPE})...`);

        return success('ok');
    };
}

/**
 * class: `LambdaWSSHandlerMain`
 * - default implementations.
 */
class LambdaWSSHandlerMain extends LambdaWSSHandler {
    public constructor() {
        super($lambda, true);
    }
}

//! create instance & export as default.
const $instance: LambdaWSSHandler = new LambdaWSSHandlerMain();
export default $instance;
