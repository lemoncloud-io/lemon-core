/**
 * Common SQS Handler in order to dispatch the target handler via SQS common.
 * - `lemon-protocol-api` 에서 각 서비스의 대표 `SQS` 에 메세지를 전달함.
 * - 그러면, 대표 SQS에 대해서는 이 SQS 핸들러가 데이터를 전달 받고, 이후 해당 API로 전달해줌.
 * - 해당 API 전달은 `_$('api-name')` 으로 찾아서 전달함.
 *
 * [Deploy]
 *  - 이 파일을 각 서비스 프로젝트에 복사하여, handler.js에 SQS 추가 `const SQS = require('./SQS')(_$)`.
 *  - `serverless.yml` 의 SQS 생성과 연결 부분을 수정하여 준다.
 *
 *
 * # SQS 활용한 Async Callback 처리 @190722
 *  - bot 실행시 'done' 파라미터와 비슷하지만, SQS 저장소가 다름!
 *
 * ```js
 * //! from caller.
 * const callback = 'lemon://messages/chat/public/slack';
 * const payload = { type: 'session', method: 'post', id, cmd: 'execute-task', param, body };
 * $sqs().do_sendMessage('lemon-sessions-sqs', { callback }, payload);
 *
 * //! from SQS.
 * if (callback) $protocol().do_post_execute(callback, body);
 * ```
 *
 *
 * @author      Tony Sung <tony@lemoncloud.io>
 * @date        2019-01-17 initial version
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-23 support `lemon-engine` v2.
 * @date        2019-08-08 fix `$protocol()`, refactored to `core/SQS.ts`
 *
 * @description Support `$protocol().do_post_notify(url, body, callback)`. (engine >1.0.13)
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
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
export interface SQSNode extends AsyncIterable {
    record: any;
    context: any;
}

/**
 * build SQS() handler.
 *
 * @param $engine   base engine instance.
 * @param defType   default type of $api()
 */
const builder: BrokerBuilder<any> = (defType, NS) => {
    defType = defType || 'hello';
    //! namespace..
    NS = NS || $U.NS(`SQS`, 'yellow'); // NAMESPACE TO BE PRINTED.

    //! load default-handler type.
    const DEFAULT_TYPE = $engine.environ('DEFAULT_TYPE', defType);

    //! process each record.
    const do_process_record = async (node: SQSNode, i: number) => {
        const context = Object.assign({}, node.context); // copy from origin context.
        const record = node.record;
        const subject = '';
        const message = (record && record.body) || '';
        const data =
            typeof message === 'string' && message.startsWith('{') && message.endsWith('}')
                ? JSON.parse(message)
                : message;
        _log(NS, `! record[${i}].${subject} =`, typeof data, $U.json(data));
        //! validate & filter inputs.
        if (!data) return Promise.resolve({ error: 'empty data!' });

        //! get callback url via attributes.
        const attributes = record.messageAttributes || {};
        // _inf(NS, `> attributes =`, attributes);
        // { callback: { stringValue: 'lemon://messages/chat/public/slack', stringListValues: [], binaryListValues: [], dataType: 'String' } }
        const callback = (attributes.callback && attributes.callback['stringValue']) || '';
        _inf(NS, `> callback =`, callback);

        //! extract parameters....
        const TYPE = data.type || DEFAULT_TYPE || '';
        const METHOD = `${data.method || 'get'}`.toUpperCase();
        const id = data.id;
        const cmd = data.cmd;
        const param = data.param || {};
        const body = data.body || '';

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
    const SQS: CoreHandler<any> = (event, context, callback) => {
        //!WARN! allows for using callbacks as finish/error-handlers
        context.callbackWaitsForEmptyEventLoop = false;

        //! serialize records one by one.
        const nodes: SQSNode[] = (event.Records || []).map((record: any) => {
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
    return SQS;
};

//! export as default
export default builder;
