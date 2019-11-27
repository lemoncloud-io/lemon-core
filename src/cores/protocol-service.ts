/**
 * file: `cores/protocol-service.ts`
 * - inter communication protocol services
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-27 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U } from '../engine/';
import { ProtocolService, ProtocolParam, ProtocolTransformer } from './core-types';
import { APIGatewayProxyEvent, SNSEvent, SQSEvent } from 'aws-lambda';
const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `MyConfigService`
 * - main implementation for `protocol-service`
 * - support protocol via `API(WEB)` + `SNS` + `SQS`
 */
export class MyProtocolService implements ProtocolService {
    protected web: WEBProtocolTransformer = new WEBProtocolTransformer();
    protected sns: SNSProtocolTransformer = new SNSProtocolTransformer();
    protected sqs: SQSProtocolTransformer = new SQSProtocolTransformer();

    /**
     * default constructor.
     */
    public constructor() {
        _log(NS, `MyProtocolService()..`);
    }
    /**
     * synchronized call to target function.
     *
     * @param param     the calling param
     */
    public async execute<T>(param: ProtocolParam): Promise<T> {
        const res: T = null;
        return res;
    }

    /**
     * Asynchronized call to target function.
     *
     * @param param     the calling param
     * @param callback  the return target
     */
    public async notify(param: ProtocolParam, callback?: ProtocolParam): Promise<string> {
        const res: string = null;
        return res;
    }
}

/**
 * class: `WEBProtocolTransformer`
 * - transformer for `WEB` Handler
 */
export class WEBProtocolTransformer implements ProtocolTransformer<APIGatewayProxyEvent, APIGatewayProxyEvent> {
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(param: ProtocolParam): APIGatewayProxyEvent {
        const res: APIGatewayProxyEvent = null;
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: APIGatewayProxyEvent): ProtocolParam {
        const res: ProtocolParam = null;
        return res;
    }
}

/**
 * class: `SNSProtocolTransformer`
 * - transformer for `SNS` Handler
 */
export class SNSProtocolTransformer implements ProtocolTransformer<SNSEvent, SNSEvent> {
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(param: ProtocolParam): SNSEvent {
        const res: SNSEvent = null;
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SNSEvent): ProtocolParam {
        const res: ProtocolParam = null;
        return res;
    }
}

/**
 * class: `SQSProtocolTransformer`
 * - transformer for `SQS` Handler
 */
export class SQSProtocolTransformer implements ProtocolTransformer<SQSEvent, SQSEvent> {
    /**
     * transform param to event
     * @param param     the calling param.
     */
    public transformToEvent(param: ProtocolParam): SQSEvent {
        const res: SQSEvent = null;
        return res;
    }

    /**
     * transform event data to param
     * @param event     the lambda compartible event data.
     */
    public transformToParam(event: SQSEvent): ProtocolParam {
        const res: ProtocolParam = null;
        return res;
    }
}
