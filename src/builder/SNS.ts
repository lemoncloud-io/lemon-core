/**
 * `core/SNS.ts`
 *
 * # Core SNS Handler
 * - `lemon-protocol-api` 에서 각 서비스의 대표 `SNS` 에 메세지를 전달함.
 * - 그러면, 대표 SNS에 대해서는 이 SNS 핸들러가 데이터를 전달 받고, 이후 해당 API로 전달해줌.
 * - 해당 API 전달은 `_$('api-name')` 으로 찾아서 전달함.
 * - SNS 는 최대 약 5분의 실행 시간이 설정됨. 반면 API는 약 30초 정도로 설정.
 *
 *
 * @author       Steve Jung <steve@lemoncloud.io>
 * @date         2018-11-25 To support `$protocol().do_post_notify(url, body, callback)`. (engine >1.0.13)
 * @date         2019-07-23 support `lemon-engine` v2
 * @date         2019-08-08 fix `$protocol()`, refactored to `core/SNS.ts`
 *
 * @copyright   (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
/** ********************************************************************************************************************
 *  Common Headers
 ** ********************************************************************************************************************/
//! import core engine.
import { $U, _log, _inf, _err } from '../core/engine';
import { $engine } from '../core/engine';
import { $protocol, $api, do_parrallel, doReportError, AsyncIterable } from '../core/engine';
import { CoreHandler, WebResult, BrokerBuilder } from '../common/types';

//! Node definition.
export interface SNSNode extends AsyncIterable {
    record: {
        Sns: {
            Subject: string;
            Message: string;
        };
    };
    context: any;
}

/**
 * build SNS() handler.
 *
 * @param NS        namespace to print
 * @param defType   default type of $api()
 */
const builder: BrokerBuilder<any> = (defType, NS) => {
    defType = defType || 'hello';
    //! namespace..
    NS = NS || $U.NS(`SNS`, 'yellow'); // NAMESPACE TO BE PRINTED.

    //! load default-handler type.
    const DEFAULT_TYPE = $engine.environ('DEFAULT_TYPE', defType);

    /**
     * process each record.
     *
     * @param node  data set
     * @param i     index in `.Records[]`
     */
    const do_process_record = async (node: SNSNode, i: number = 0) => {
        const context = Object.assign({}, node.context); // copy from origin context.
        const record = node.record;
        //! catch SNS Record.
        const sns = record && record.Sns;
        const subject = (sns && sns.Subject) || '';
        const message = (sns && sns.Message) || '';
        const data =
            typeof message === 'string' && message.startsWith('{') && message.endsWith('}')
                ? JSON.parse(message)
                : message;
        _log(NS, `! record[${i}].${subject} =`, typeof data, $U.json(data));

        //! validate & filter inputs.
        if (!data) throw new Error(`[${i}].data(Message) is required!`);

        //! extract parameters....
        const TYPE = data.type || DEFAULT_TYPE || '';
        const METHOD = `${data.method || 'get'}`.toUpperCase();
        const id = data.id;
        const cmd = data.cmd;
        const param = data.param || {};
        const body = data.body || '';
        const callback = data.callback; // callback url (WARN! must be called w/ lambda) SNS -> SNS -> SNS 부르는 무한반복 문제?!!

        //! transform to APIGatewayEvent;
        const event = {
            httpMethod: METHOD,
            path: cmd ? `/${id}/${cmd}` : id !== undefined ? `/${id}` : `/`,
            headers: {},
            pathParameters: { id, cmd },
            queryStringParameters: param,
            body: body,
            isBase64Encoded: false,
            stageVariables: null as any,
            requestContext: {},
            resource: '',
        };

        //! execute web-handler. then call callback if required.
        return $api(TYPE)
            .do(event, context)
            .then((body: WebResult) => {
                if (!callback) return body; // ignore
                //! filtering via remote web-hook!.
                return $protocol()
                    .do_post_execute(callback, body)
                    .then((_: any) => {
                        _log(NS, `! CALLBACK[${callback}] =`, typeof _, $U.json(_));
                        return _;
                    })
                    .catch((e: any) => {
                        _err(NS, `! ERR@CALLBACK[${callback}] =`, e);
                        //NOTE! - report error in here.
                        return doReportError(e, context, { callback, body }).then(() => Promise.reject(e));
                    });
            });
    };

    //! Common SNS Handler for lemon-protocol integration.
    const SNS: CoreHandler<any> = (event, context, callback) => {
        //!WARN! allows for using callbacks as finish/error-handlers
        context.callbackWaitsForEmptyEventLoop = false;

        //! serialize records one by one.
        const nodes: SNSNode[] = (event.Records || []).map((record: any) => {
            return { record, context };
        });

        //! execute each records, and returns.
        do_parrallel(nodes, do_process_record, 1)
            .then((_: any) => {
                _inf(NS, '! done =', _);
                callback(null, _);
            })
            .catch((e: Error) => {
                _inf(NS, '! error =', e);
                callback(e);
            });
    };
    //! export default.
    return SNS;
};

//! export default.
export default builder;
