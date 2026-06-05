/**
 * `aws-lambda-helper.example.ts`
 * - runnable example for `invokeLambda()`.
 *
 * Examples:
 * ```sh
 * npm run example:lambda
 * npm run example:lambda -- --target lemon-hello-api-dev-lambda --profile lemon
 * npm run example:lambda -- --target lemon-hello-api-dev-lambda --payload-json '{"httpMethod":"GET","path":"/hello"}'
 * npm run example:lambda -- --target lemon-hello-api-dev-lambda --raw-payload '{"ping":"pong"}'
 * npm run example:lambda -- --target lemon-hello-api-dev-lambda --payload-file ./data/samples/events/sample.event.web.api.json
 * ```
 */
import fs from 'fs';
import { fromIni } from '@aws-sdk/credential-providers';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { $U } from '../engine';
import { ProtocolParam } from '../cores/core-services';
import { invokeLambda } from '../cores/protocol/aws-lambda-helper';
import { AwsConfigParams } from './tools';

type ExampleArgs = {
    target: string;
    profile?: string;
    region: string;
    payloadJson?: string;
    payloadFile?: string;
    rawPayload?: string;
};

const NS = '[lambda-example]';
const DEFAULT_ARGS: ExampleArgs = {
    target: 'lemon-hello-api-dev-lambda',
    region: 'ap-northeast-2',
    profile: undefined,
};

const HELP = `
Usage:
  npm run example:lambda -- [options]

Options:
  --target <name>         Lambda function name. default: ${DEFAULT_ARGS.target}
  --profile <name>        AWS profile name. default: AWS SDK default credential chain
  --region <region>       AWS region. default: ${DEFAULT_ARGS.region}
  --payload-json <json>   APIGatewayProxyEvent JSON payload
  --payload-file <path>   APIGatewayProxyEvent JSON file path
  --raw-payload <string>  Raw string payload
  --help                  Print this help
`;

const parseJson = <T>(label: string, value: string): T => {
    try {
        return JSON.parse(value) as T;
    } catch (e) {
        const message = e instanceof Error ? e.message : `${e}`;
        throw new Error(`${label} is not valid JSON - ${message}`);
    }
};

const defaultEvent = (): APIGatewayProxyEvent =>
    ({
        resource: '/hello',
        path: '/hello',
        httpMethod: 'GET',
        headers: {
            'content-type': 'application/json',
            'x-protocol-context': JSON.stringify({ requestId: 'local-example', accountId: '' }),
        },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: { type: 'hello', id: '', cmd: '' },
        stageVariables: null,
        requestContext: {
            accountId: '',
            apiId: 'local-example',
            authorizer: undefined,
            protocol: 'HTTP/1.1',
            httpMethod: 'GET',
            identity: null as any,
            path: '/hello',
            stage: '',
            requestId: 'local-example',
            requestTimeEpoch: Date.now(),
            resourceId: 'local-example',
            resourcePath: '/hello',
        },
        body: null,
        isBase64Encoded: false,
    } as APIGatewayProxyEvent);

const parseArgs = (argv: string[]): ExampleArgs => {
    const args: ExampleArgs = { ...DEFAULT_ARGS };
    const aliases: Record<string, keyof ExampleArgs> = {
        '--target': 'target',
        '--function-name': 'target',
        '--profile': 'profile',
        '--region': 'region',
        '--payload-json': 'payloadJson',
        '--payload-file': 'payloadFile',
        '--raw-payload': 'rawPayload',
    };

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token == '--help' || token == '-h') {
            console.info(HELP.trim());
            process.exit(0);
        }

        const eqIndex = token.indexOf('=');
        const key = eqIndex > 0 ? token.substring(0, eqIndex) : token;
        const prop = aliases[key];
        if (!prop) throw new Error(`Unknown option: ${token}`);

        const value = eqIndex > 0 ? token.substring(eqIndex + 1) : argv[++i];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`${key} requires a value.`);
        }
        (args[prop] as string) = value;
    }

    return args;
};

const loadPayload = (args: ExampleArgs): APIGatewayProxyEvent | string => {
    if (args.rawPayload) return args.rawPayload;
    if (args.payloadJson) return parseJson<APIGatewayProxyEvent>('payloadJson', args.payloadJson);
    if (args.payloadFile) {
        const raw = fs.readFileSync(args.payloadFile, 'utf8');
        return parseJson<APIGatewayProxyEvent>(`payloadFile(${args.payloadFile})`, raw);
    }
    return defaultEvent();
};

const buildConfig = (args: ExampleArgs): AwsConfigParams => {
    const region = args.region;
    const profile = args.profile;
    return {
        region,
        profile,
        credentials: profile ? fromIni({ profile }) : undefined,
    };
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = args.target;

    const payload = loadPayload(args);
    const config = buildConfig(args);
    const param: ProtocolParam = {
        service: target,
        type: 'lambda-helper-example',
        mode: (typeof payload === 'string' ? 'POST' : payload.httpMethod || 'GET') as ProtocolParam['mode'],
        context: { requestId: `local-${Date.now()}`, accountId: '' },
    };

    console.info(NS, 'start invokeLambda()');
    console.info(NS, 'target =', target);
    console.info(NS, 'region =', config.region);
    console.info(NS, 'profile =', config.profile || '(default credential chain)');
    console.info(NS, 'payload.type =', typeof payload);
    console.info(NS, 'payload.preview =', $U.S(payload, 720, 96, ' .... '));

    const startedAt = Date.now();
    try {
        const result = await invokeLambda<unknown>(target, payload, { param, config });
        console.info(NS, 'success = true');
        console.info(NS, 'elapsed.ms =', Date.now() - startedAt);
        console.info(NS, 'result =', $U.S(result, 1200, 128, ' .... '));
    } catch (e) {
        console.error(NS, 'success = false');
        console.error(NS, 'elapsed.ms =', Date.now() - startedAt);
        console.error(NS, 'error =', e instanceof Error ? e.stack || e.message : e);
        process.exitCode = 1;
    }
};

main().catch(e => {
    console.error(NS, 'fatal =', e instanceof Error ? e.stack || e.message : e);
    process.exitCode = 1;
});
