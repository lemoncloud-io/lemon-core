import { _log, _inf, _err, $U } from '../../engine/';
import { onlyDefined } from '../../common/test-helper';
import { ProtocolParam } from '../core-services';
import { AwsConfigParams } from '../../tools/tools';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { InvocationRequest, InvokeCommandOutput } from '@aws-sdk/client-lambda';
import { measureAsync } from '../../lib/perf';
import { asLemonError } from '../../common/lemon-error';
const NS = $U.NS('PRTL', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * `@aws-sdk/client-lambda`, imported on the first use (not at import; v5 B2-c, K6).
 * - must stay `import()` (not `require`): `aws-lambda-helper.spec.ts` replaces the package with `vi.mock`.
 */
let $lambda: Promise<typeof import('@aws-sdk/client-lambda')>;
// memoized loader (the first call prints one `PERF` line).
const loadLambda = () =>
    ($lambda ??= measureAsync(
        _inf,
        $U.NS('PERF', 'cyan'),
        'lazy-load @aws-sdk/client-lambda',
        () => import('@aws-sdk/client-lambda'),
    ));

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
        useEvent?: boolean; // if true, invoke lambda asynchronously with InvocationType 'Event'.
    },
): Promise<T> {
    const param: ProtocolParam | undefined = options?.param;
    const config: AwsConfigParams = options?.config ?? {};
    const useEvent = options?.useEvent ?? false;
    const errScope = `invokeLambda(${target ?? ''})`;
    if (!target) throw new Error(`@target(function) is required - ${errScope}`);

    //* prepare lambda payload.
    const params = onlyDefined<InvocationRequest>({
        FunctionName: target,
        Payload: payload
            ? new TextEncoder().encode(typeof payload === 'string' ? payload : $U.json(payload))
            : undefined,
        ClientContext: undefined,
        InvocationType: useEvent ? 'Event' : undefined,
    });
    // _log(NS, `> params =`, $U.json(params));

    //* call lambda (a new client per call, so no `PERF > client` line).
    const { LambdaClient, InvokeCommand } = await loadLambda();
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

            //* if useEvent is true and status code is 202, then return directly without parsing payload.
            if (useEvent && statusCode == 202) return asInvokeLogData(data);

            //* v5 B5: any 2xx is a success (SPEC § 6.6).
            const isOk = statusCode >= 200 && statusCode < 300;
            //* for debug, print whole data if status code is not 2xx.
            const hasWarn = !isOk;
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

            //* returns — v5: a `LemonError` with the peer status, the message string is unchanged (wire contract).
            if (statusCode == 400 || statusCode == 404)
                return Promise.reject(asLemonError(statusCode, $U.S(body) || '404 NOT FOUND'));
            else if (!isOk) {
                if (typeof body == 'string' && body.startsWith('404 NOT FOUND')) throw asLemonError(statusCode, body);
                throw asLemonError(statusCode, $U.S(body) || `Lambda Error. status:${statusCode}`);
            }
            //* v5: a 2xx without body (ex: 204) → `null`.
            if (body === undefined || body === '') return statusCode == 200 || statusCode == 201 ? body : null;
            return body;
        });
    const res: T = response as T;
    return res;
}
