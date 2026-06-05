import { _log, _inf, _err, $U } from '../../engine/';
import { InvocationRequest, InvokeCommand, InvokeCommandOutput, LambdaClient } from '@aws-sdk/client-lambda';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { ProtocolParam } from '../core-services';
import { AwsConfigParams } from '../../tools/tools';
const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.

const asPayloadText = (payload?: Uint8Array): string | undefined =>
    payload ? Buffer.from(payload).toString() : undefined;

const asInvokeLogData = (data: InvokeCommandOutput): Omit<InvokeCommandOutput, 'Payload'> & { Payload?: string } => ({
    ...data,
    Payload: asPayloadText(data.Payload),
});

/**
 * invoke lambda function with given payload.
 * - `param` is used for logging and error reporting.
 */
export async function invokeLambda<T>(
    target: string,
    payload: APIGatewayProxyEvent | string,
    options?: {
        param?: ProtocolParam;
        config?: AwsConfigParams;
    },
): Promise<T> {
    const param: ProtocolParam | undefined = options?.param;
    const config: AwsConfigParams = options?.config ?? {};
    const errScope = `invokeLambda(${target ?? ''})`;
    if (!target) throw new Error(`@target(function) is required - ${errScope}`);

    //* prepare lambda payload.
    const params: InvocationRequest = {
        FunctionName: target,
        Payload: payload
            ? new TextEncoder().encode(typeof payload === 'string' ? payload : $U.json(payload))
            : undefined,
        ClientContext: undefined,
        // InvocationType: 'Event',
    };
    // _log(NS, `> params =`, $U.json(params));

    //* call lambda.
    const lambda = new LambdaClient(config);
    const response = await lambda
        .send(new InvokeCommand(params))
        .catch((e: Error) => {
            _err(NS, `! execute[${param?.service ?? ''}].err =`, typeof e, e);
            // return this.doReportError(e, param.context, null, { protocol: uri, param });
            throw e;
        })
        .then((data: InvokeCommandOutput) => {
            const payloadText = asPayloadText(data?.Payload);
            _log(NS, `! execute[${param?.service ?? ''}].res =`, $U.S(asInvokeLogData(data), 320, 64, ' .... '));
            const payload = payloadText ? JSON.parse(payloadText) : {};
            const statusCode = $U.N(payload.statusCode || (data && data.StatusCode), 200);
            _log(NS, `> Lambda[${params.FunctionName}].StatusCode :=`, statusCode);
            _log(NS, `> Lambda[${params.FunctionName}].ContentSize :=`, payloadText ? payloadText.length : 0);

            //* for debug, print whole data if status code is not 200 or 201.
            const hasWarn = ![200, 201].includes(statusCode);
            if (hasWarn) _inf(NS, `> WARN! status[${statusCode}] data =`, $U.S(asInvokeLogData(data)));

            //* safe parse payload.body.
            const body = (() => {
                try {
                    if (payload.text && typeof payload.text == 'string') return payload.text;
                    return payload.body && typeof payload.body == 'string' ? JSON.parse(payload.body) : payload.body;
                } catch (e) {
                    _log(NS, `> WARN! payload.body =`, $U.S(payload.body));
                    return payload.body;
                }
            })();

            //* returns
            if (statusCode == 400 || statusCode == 404) return Promise.reject(new Error($U.S(body) || '404 NOT FOUND'));
            else if (statusCode != 200 && statusCode != 201) {
                if (typeof body == 'string' && body.startsWith('404 NOT FOUND')) throw new Error(body);
                throw new Error($U.S(body) || `Lambda Error. status:${statusCode}`);
            }
            return body;
        });
    const res: T = response as T;
    return res;
}
