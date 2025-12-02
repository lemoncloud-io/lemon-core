/**
 * `protocol-service.spec.ts`
 * - unit test for `protocol-service`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-27 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { expect2, GETERR } from '../../common/test-helper';
import { NextContext } from 'lemon-model';
import {
    MyProtocolService,
    WEBProtocolTransformer,
    SNSProtocolTransformer,
    SQSProtocolTransformer,
} from './protocol-service';
import { MyConfigService, ConfigService } from './../config/config-service';
import { ProtocolParam, STAGE, CallbackParam } from './../core-services';
import { APIGatewayProxyEvent } from 'aws-lambda';

const DEF_SERVICE = 'lemon-hello-api';

//* Mock AWS SDK clients with simplified mocks
jest.mock('@aws-sdk/client-sns', () => {
    const actual = jest.requireActual('@aws-sdk/client-sns');
    return {
        ...actual,
        SNSClient: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                MessageId: `mock-message-id-${Date.now()}`,
            }),
        })),
    };
});

jest.mock('@aws-sdk/client-sqs', () => {
    const actual = jest.requireActual('@aws-sdk/client-sqs');
    let messageCounter = 1;
    return {
        ...actual,
        SQSClient: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                MessageId: `mock-message-${messageCounter++}`,
                MD5OfBody: 'mock-md5-hash',
            }),
        })),
    };
});

jest.mock('@aws-sdk/client-lambda', () => {
    const actual = jest.requireActual('@aws-sdk/client-lambda');
    return {
        ...actual,
        LambdaClient: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation(async (command: any) => {
                const commandName = command.constructor?.name;
                if (commandName === 'InvokeCommand') {
                    const functionName = command.input?.FunctionName || 'mock-function';
                    const mockResponse = {
                        statusCode: 200,
                        body: JSON.stringify({ message: 'mock-lambda-success', function: functionName }),
                    };
                    return {
                        StatusCode: 200,
                        Payload: new TextEncoder().encode(JSON.stringify(mockResponse)),
                    };
                }
                return {};
            }),
        })),
    };
});

jest.mock('../aws/', () => ({
    sns: {
        endpoint: jest.fn().mockResolvedValue('arn:aws:sns:ap-northeast-2:123456789012:mock-topic'),
    },
}));
const createSimpleHandlerMock = () => {
    return class {
        public static instances: any[] = [];
        public args: any[];
        public constructor(...args: any[]) {
            this.args = args;
            (this.constructor as any).instances.push(this);
        }
    };
};
jest.mock('../lambda/lambda-handler', () => {
    const handleMock = jest.fn(async (event?: any, context?: any) => {
        void event;
        void context;
        return 'lambda-handled';
    });
    class LambdaHandler {
        public static handleMock = handleMock;
        public static instances: any[] = [];
        public config: any;
        public constructor() {
            LambdaHandler.instances.push(this);
        }
        public handle(event?: any, context?: any) {
            return LambdaHandler.handleMock(event, context);
        }
    }
    class Context {}
    return { LambdaHandler, Context };
});
jest.mock('../lambda/lambda-alb-handler', () => ({ LambdaALBHandler: createSimpleHandlerMock() }));
jest.mock('../lambda/lambda-web-handler', () => ({
    LambdaWEBHandler: createSimpleHandlerMock(),
    CoreWEBController: class {},
}));
jest.mock('../lambda/lambda-sns-handler', () => ({ LambdaSNSHandler: createSimpleHandlerMock() }));
jest.mock('../lambda/lambda-sqs-handler', () => ({ LambdaSQSHandler: createSimpleHandlerMock() }));
jest.mock('../lambda/lambda-wss-handler', () => ({ LambdaWSSHandler: createSimpleHandlerMock() }));
jest.mock('../lambda/lambda-cron-handler', () => ({
    LambdaCronHandler: createSimpleHandlerMock(),
    CronNextHandler: class {},
    CronParam: class {},
}));
jest.mock('../lambda/lambda-cognito-handler', () => ({ LambdaCognitoHandler: createSimpleHandlerMock() }));
jest.mock('../lambda/lambda-dynamo-stream-handler', () => ({ LambdaDynamoStreamHandler: createSimpleHandlerMock() }));
jest.mock('../lambda/lambda-notification-handler', () => ({ LambdaNotificationHandler: createSimpleHandlerMock() }));

const resetLambdaHandlerMocks = () => {
    const { LambdaHandler } = jest.requireMock('../lambda/lambda-handler');
    LambdaHandler.handleMock.mockClear();
    LambdaHandler.instances.length = 0;
    const reset = (path: string, key: string) => {
        const handler = jest.requireMock(path)[key];
        handler.instances.length = 0;
    };
    reset('../lambda/lambda-alb-handler', 'LambdaALBHandler');
    reset('../lambda/lambda-web-handler', 'LambdaWEBHandler');
    reset('../lambda/lambda-sns-handler', 'LambdaSNSHandler');
    reset('../lambda/lambda-sqs-handler', 'LambdaSQSHandler');
    reset('../lambda/lambda-wss-handler', 'LambdaWSSHandler');
    reset('../lambda/lambda-cron-handler', 'LambdaCronHandler');
    reset('../lambda/lambda-cognito-handler', 'LambdaCognitoHandler');
    reset('../lambda/lambda-dynamo-stream-handler', 'LambdaDynamoStreamHandler');
    reset('../lambda/lambda-notification-handler', 'LambdaNotificationHandler');
};

const withLambdaModuleEngine = async (
    engine: any,
    run: (lambdaIndex: typeof import('../lambda')) => Promise<void> | void,
) => {
    jest.resetModules();
    jest.doMock('../../engine/', () => ({
        __esModule: true,
        $engine: engine,
        EngineModule: class {},
        LemonEngine: class {},
    }));
    resetLambdaHandlerMocks();
    const lambdaIndex = await import('../lambda');
    try {
        await run(lambdaIndex);
    } finally {
        jest.resetModules();
        resetLambdaHandlerMocks();
    }
};

class MyProtocolServiceTest extends MyProtocolService {
    public constructor(config?: ConfigService, service: string = DEF_SERVICE) {
        super(service, config);
    }
    public hello = () => `protocol-service-test:${this.selfService}`;
}
class MyConfigServiceTest extends MyConfigService {
    private env: { [key: string]: string };
    public constructor(env: { [key: string]: string }) {
        super(null);
        this.env = env;
    }
    public hello = () => `config-service-test:${this.getStage()}`;
    public get = (key: string): string => this.env[key];
}

class MyConfigServiceTest2 extends MyConfigService {
    private env: { [key: string]: string };
    public constructor(env: { [key: string]: string }) {
        super(null);
        this.env = env;
    }
    public hello = () => `config-service-test2:${this.getStage()}`;
    public get = (key: string): string => this.env[key];
    public getService(): string {
        return `${this.env['name'] || ''}`;
    }
    public getVersion(): string {
        return `${this.env['version'] || ''}`;
    }
    public getStage(): STAGE {
        return `${this.env['stage'] || ''}` as STAGE;
    }
}

/**
 * DummyProtocolService - Override AWS methods to avoid real AWS calls
 */
class DummyProtocolService extends MyProtocolService {
    public constructor(config?: ConfigService, service: string = DEF_SERVICE) {
        super(service, config);
    }

    //* Override execute() to return mock Lambda response
    public async execute(param: ProtocolParam, config?: ConfigService): Promise<any> {
        config = config || this.config;
        const service = `${param.service || config.getService() || ''}`;

        // Simulate Lambda response
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'dummy-execute-success',
                service,
                type: param.type,
                id: param.id,
            }),
        };
    }

    //* Override notify() to return mock SNS MessageId
    public async notify(_param: ProtocolParam, _callback?: CallbackParam, _config?: ConfigService): Promise<string> {
        void _param;
        void _callback;
        void _config;
        // Simulate SNS response
        return `dummy-message-id-${Date.now()}`;
    }

    //* Override enqueue() to return mock SQS MessageId
    public async enqueue(
        param: ProtocolParam,
        callback?: CallbackParam,
        delaySeconds?: number,
        _config?: ConfigService,
    ): Promise<string> {
        void _config;
        delaySeconds = delaySeconds !== undefined ? delaySeconds : 10;

        if (delaySeconds < 0) throw new Error(`@delaySeconds (number) should be >= 0. but ${delaySeconds}`);

        // Simulate SQS response
        return `dummy-queue-id-${Date.now()}`;
    }
}

export const instance = (env?: { [key: string]: string }) => {
    env = { STAGE: 'local', NAME: 'test', ...env };
    const config = new MyConfigServiceTest(env);
    const config2 = new MyConfigServiceTest2(env);
    const service = new MyProtocolServiceTest();
    const service2 = new MyProtocolServiceTest(config2);
    const dummy = new DummyProtocolService(config);
    return { service, config, service2, config2, dummy };
};

const asParam = (service: string, type?: string, base?: any): ProtocolParam => {
    const param: ProtocolParam = {
        service,
        type,
        context: {},
        ...base,
    };
    return param;
};

//! main test body.
describe('ProtocolService', () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* dummy service.
    it('should pass basic protocol', async () => {
        const { service, config } = instance();
        expect2(() => {
            throw new Error('HI Error');
        }).toBe('HI Error');
        expect2(service.hello()).toEqual('protocol-service-test:lemon-hello-api');
        expect2(config.hello()).toEqual('config-service-test:local');
    });

    //* transformer
    it('should pass asTransformer()', async () => {
        const { service } = instance();
        expect2(service.asTransformer('web') instanceof WEBProtocolTransformer).toBe(true);
        expect2(service.asTransformer('sns') instanceof SNSProtocolTransformer).toBe(true);
        expect2(service.asTransformer('sqs') instanceof SQSProtocolTransformer).toBe(true);
    });

    //* in local environ.
    it('should pass asServiceURI() w/ local', async () => {
        const { service, config } = instance();
        expect2(config.hello()).toEqual('config-service-test:local');

        //* as standard format name.
        expect2(service.asProtocolURI('web', asParam(''), config)).toEqual('web://lemon-hello-api-dev-lambda');
        expect2(service.asProtocolURI('sns', asParam('self'), config)).toEqual('sns://lemon-hello-sns-dev');
        expect2(service.asProtocolURI('sqs', asParam(''), config)).toEqual('sqs://lemon-hello-sqs-dev');

        //* as non-standard format.
        expect2(service.asProtocolURI('web', asParam('lemon-lambda'), config)).toEqual('web://lemon-lambda-dev-lambda');
        expect2(service.asProtocolURI('sns', asParam('lemon-lambda'), config)).toEqual('sns://lemon-lambda-dev');
        expect2(service.asProtocolURI('sqs', asParam('lemon-lambda'), config)).toEqual('sqs://lemon-lambda-dev');

        //* check path. (id should be encoded)
        expect2(service.asProtocolURI('sqs', asParam('', 'test'), config)).toEqual('sqs://lemon-hello-sqs-dev/test');
        expect2(service.asProtocolURI('sqs', asParam('', 'test/0'), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test%2F0',
        );
        expect2(service.asProtocolURI('sqs', asParam('', 'test 0'), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test%200',
        );

        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id: '' }), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test/',
        );
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id: '1' }), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test/1',
        );
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id: '', cmd: '' }), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test/',
        );
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id: '1', cmd: '2' }), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test/1/2',
        );
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id: '', cmd: '2' }), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test//2',
        );
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id: '1', cmd: '2/3' }), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test/1/2/3',
        );
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id: '1/2', cmd: '3' }), config)).toEqual(
            'sqs://lemon-hello-sqs-dev/test/1%2F2/3',
        );
    });

    //* in develop environ.
    it('should pass asServiceURI() w/ develop', async () => {
        const { service, config } = instance({ STAGE: 'develop' });
        expect2(config.hello()).toEqual('config-service-test:dev');

        //* as standard format name.
        expect2(service.asProtocolURI('web', asParam(''), config)).toEqual('web://lemon-hello-api-dev-lambda');
        expect2(service.asProtocolURI('sns', asParam(''), config)).toEqual('sns://lemon-hello-sns-dev');
        expect2(service.asProtocolURI('sqs', asParam('self'), config)).toEqual('sqs://lemon-hello-sqs-dev');

        //* as non-standard format.
        const param2 = asParam('lemon-lambda');
        param2.context.accountId = '1122';
        expect2(service.asProtocolURI('web', param2, config)).toEqual('web://1122@lemon-lambda-dev-lambda');
        expect2(service.asProtocolURI('sns', param2, config)).toEqual('sns://1122@lemon-lambda-dev');
        expect2(service.asProtocolURI('sqs', param2, config)).toEqual('sqs://1122@lemon-lambda-dev');
    });

    //* in production environ.
    it('should pass asServiceURI() w/ production', async () => {
        const { service, config } = instance({ STAGE: 'production' });
        expect2(config.hello()).toEqual('config-service-test:prod');

        //* as standard format name.
        expect2(service.asProtocolURI('web', asParam('self'), config)).toEqual('web://lemon-hello-api-prod-lambda');
        expect2(service.asProtocolURI('sns', asParam(''), config)).toEqual('sns://lemon-hello-sns');
        expect2(service.asProtocolURI('sqs', asParam(''), config)).toEqual('sqs://lemon-hello-sqs');

        //* as non-standard format.
        const param2 = asParam('lemon-web');
        expect2(service.asProtocolURI('web', param2, config)).toEqual('web://lemon-web-prod-lambda');
        expect2(service.asProtocolURI('sns', param2, config)).toEqual('sns://lemon-web');
        expect2(service.asProtocolURI('sqs', param2, config)).toEqual('sqs://lemon-web');
    });

    //* for each event protocol
    it('should pass transformEvent() of web.local', async () => {
        const { service, config } = instance();
        const param = asParam('', 'test', { id: 'abc' });
        const uri = service.asProtocolURI('web', param, config);
        expect2(uri).toEqual('web://lemon-hello-api-dev-lambda/test/abc');
        expect2(service.transformEvent(uri, param), 'headers').toEqual({ headers: { 'x-protocol-context': '{}' } });
        expect2(service.transformEvent(uri, param), 'httpMethod,path').toEqual({
            httpMethod: 'GET',
            path: '/test/abc',
        });
        expect2(service.transformEvent(uri, param), 'pathParameters').toEqual({
            pathParameters: { id: 'abc', cmd: '', type: 'test' },
        });
        const requestContext = {
            accountId: '',
            httpMethod: 'GET',
            identity: null as any,
            path: '/test/abc',
            requestId: '',
            stage: '',
        };
        expect2(service.transformEvent(uri, param), 'requestContext').toEqual({ requestContext });

        //* now verify with real lambda call.
        if (PROFILE == 'lemon') {
            expect2(await service.execute(param).catch(GETERR)).toEqual('404 NOT FOUND - GET /test/abc');

            const helloParam = asParam('', 'hello', { id: undefined });
            expect2(await service.execute(helloParam).catch(GETERR)).toEqual({
                list: [{ name: 'lemon' }, { name: 'cloud' }],
                name: 'lemon',
            });
        }
    });

    //* for each event protocol
    it('should pass transformEvent() of web.dev', async () => {
        const { service, config } = instance({ STAGE: 'develop' });
        const $ctx: NextContext = { requestId: 'xxxx', accountId: '0908' };
        const id = '0';
        const param = asParam('lemon-metrics-api', 'metrics', {
            id,
            param: { ns: 'TestTable', id: 'abc-123', type: 'TEST', ts: 1567052044463 },
            context: $ctx,
        });
        const uri = service.asProtocolURI('web', param, config);
        const path = '/metrics/0';
        expect2(uri).toEqual('web://0908@lemon-metrics-api-dev-lambda/metrics/0');
        expect2(service.transformEvent(uri, param), 'headers').toEqual({
            headers: { 'x-protocol-context': JSON.stringify($ctx) },
        });
        expect2(service.transformEvent(uri, param), 'httpMethod,path').toEqual({ httpMethod: 'GET', path });
        expect2(service.transformEvent(uri, param), 'pathParameters').toEqual({
            pathParameters: { id, cmd: '', type: 'metrics' },
        });
        const requestContext = {
            accountId: '0908',
            httpMethod: 'GET',
            identity: null as any,
            path,
            requestId: 'xxxx',
            stage: '',
        };
        expect2(service.transformEvent(uri, param), 'requestContext').toEqual({ requestContext });

        //* now verify with real lambda call.
        if (PROFILE == 'comics') {
            // expect2(await service.execute(param, config).catch(GETERR)).toEqual('@ns is required!');
            // expect2(await service.execute(param, config).catch(GETERR)).toEqual('@id is required!');
            expect2(await service.execute(param, config).catch(GETERR)).toEqual(
                '404 NOT FOUND - @id:TestTable_abc-123_TEST/1567052044463',
            );
            const testData: any = await service.execute({ ...param, cmd: 'test-load-data' }, config);
            expect2(() => testData[0], 'item').toEqual({ item: { count: 1, id: 'abc-123', name: 'abc 1' } });
        }

        //* test with transformToParam()
        const event2 = service.transformEvent(uri, param) as APIGatewayProxyEvent;
        const param2 = service.web.transformToParam(event2, $ctx);
        expect2(param2, 'service,stage,type').toEqual({ service: '', stage: '', type: 'metrics' });
        expect2(param2, 'mode,id,cmd').toEqual({ mode: 'GET', id, cmd: '' });
        expect2(param2, 'param').toEqual({
            param: { ns: 'TestTable', id: 'abc-123', type: 'TEST', ts: 1567052044463 },
        });
        expect2(param2, 'body').toEqual({ body: null });
        expect2(param2.context).toEqual($ctx);

        //* test of body-data.
        const webhdr0 = { 'content-type': '', 'x-protocol-context': '' };
        const _transform = (e: any) => service.web.transformToParam(e, $ctx);
        expect2(() => _transform({ ...event2, headers: { ...webhdr0 }, body: '' }), 'body').toEqual({
            body: '',
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr0 }, body: null }), 'body').toEqual({ body: null });
        expect2(() => _transform({ ...event2, headers: { ...webhdr0 }, body: {} as any }), 'body').toEqual({
            body: {},
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr0 }, body: '{}' }), 'body').toEqual({ body: {} });
        expect2(() => _transform({ ...event2, headers: { ...webhdr0 }, body: '[]' }), 'body').toEqual({ body: [] });
        expect2(() => _transform({ ...event2, headers: { ...webhdr0 }, body: 'a=b' }), 'body').toEqual({ body: 'a=b' });
        expect2(() => _transform({ ...event2, headers: { ...webhdr0 }, body: 'a%5Bb%5D=c' }), 'body').toEqual({
            body: 'a%5Bb%5D=c',
        });

        const webhdr1 = { 'content-type': 'application/json', 'x-protocol-context': '' };
        expect2(() => _transform({ ...event2, headers: { ...webhdr1 }, body: '' }), 'body').toEqual({
            body: '',
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr1 }, body: null }), 'body').toEqual({ body: null });
        expect2(() => _transform({ ...event2, headers: { ...webhdr1 }, body: {} as any }), 'body').toEqual({
            body: {},
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr1 }, body: '{}' }), 'body').toEqual({ body: {} });
        expect2(() => _transform({ ...event2, headers: { ...webhdr1 }, body: '[]' }), 'body').toEqual({ body: [] });
        expect2(() => _transform({ ...event2, headers: { ...webhdr1 }, body: 'a=b' }), 'body').toEqual(
            '@body[a=b] is not valid JSON - web.transformToParam(/metrics/0)',
        );
        expect2(() => _transform({ ...event2, headers: { ...webhdr1 }, body: 'a%5Bb%5D=c' }), 'body').toEqual(
            '@body[a%5Bb%5D=c] is not valid JSON - web.transformToParam(/metrics/0)',
        );

        const webhdr2 = {
            'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
            'x-protocol-context': '',
        };
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: '' }), 'body').toEqual({
            body: '',
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: null }), 'body').toEqual({ body: null });
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: {} as any }), 'body').toEqual({
            body: {},
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: '{}' }), 'body').toEqual({ body: {} });
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: '[]' }), 'body').toEqual({ body: [] });
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: 'a=b' }), 'body').toEqual({
            body: { a: 'b' },
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: 'a%5B%5D=c' }), 'body').toEqual({
            body: { a: ['c'] },
        });
        expect2(() => _transform({ ...event2, headers: { ...webhdr2 }, body: 'a%5Bb%5D=c' }), 'body').toEqual({
            body: { a: { b: 'c' } },
        });

        //* error exceptions
        expect2(() => _transform({ ...event2, headers: null })).toEqual(
            '.headers (object) is required - web.transformToParam(/metrics/0)',
        );
        expect2(() => _transform({ ...event2, requestContext: null })).toEqual(
            '.requestContext (object) is required - web.transformToParam(/metrics/0)',
        );
        expect2(() => _transform({ ...event2, requestContext: { ...event2.requestContext, accountId: '' } })).toEqual(
            '400 INVALID CONTEXT - accountId:0908 @web.transformToParam(/metrics/0)',
        );
        expect2(() => _transform({ ...event2, requestContext: { ...event2.requestContext, requestId: '' } })).toEqual(
            '400 INVALID CONTEXT - requestId:xxxx @web.transformToParam(/metrics/0)',
        );
        expect2(() => _transform({ ...event2, headers: {} })).toEqual({
            service: '',
            type: 'metrics',
            stage: '',
            id: '0',
            cmd: '',
            mode: 'GET',
            param: { ...param2?.param },
            body: null,
            context: { ...$ctx },
        });
    });

    //* for each event protocol
    it('should pass transformEvent() of sns', async () => {
        const { service, config } = instance();
        const id = 'abc';
        const param = asParam('', 'test', { id });
        const uri = service.asProtocolURI('sns', param, config);
        expect2(uri).toEqual('sns://lemon-hello-sns-dev/test/abc');
    });

    //* for each event protocol
    it('should pass transformEvent() of sqs', async () => {
        const { service, config } = instance();
        const id = 'abc';
        const param = asParam('', 'test', { id });
        const uri = service.asProtocolURI('sqs', param, config);
        expect2(uri).toEqual('sqs://lemon-hello-sqs-dev/test/abc');
    });

    //* in local environ.
    it('should pass fromURL() w/ local', async () => {
        const { service } = instance();
        expect2(service.hello()).toEqual('protocol-service-test:lemon-hello-api');

        const context: NextContext = {};
        expect2(() => service.fromURL(context, 'http://self/'), 'service,type').toEqual(
            '@url - protocol not supportable (http://)',
        );
        expect2(() => service.fromURL(context, 'lemon://self/'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: '',
            id: null,
            cmd: null,
        });
        expect2(() => service.fromURL(context, 'lemon://self/a'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: null,
            cmd: null,
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: '',
            cmd: null,
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: 'b',
            cmd: null,
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: 'b',
            cmd: '',
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: 'b',
            cmd: 'c',
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: 'b',
            cmd: 'c/',
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/d'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: 'b',
            cmd: 'c/d',
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/d/'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: 'b',
            cmd: 'c/d/',
        });

        expect2(() => service.fromURL(context, 'lemon://u@self/a/b/c/d/'), 'service,type,id,cmd').toEqual({
            service: 'self',
            type: 'a',
            id: 'b',
            cmd: 'c/d/',
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/d/'), 'context').toEqual({ context: {} });
        expect2(() => service.fromURL(context, 'lemon://u@self/a/b/c/d/'), 'context').toEqual({
            context: { accountId: 'u' },
        });

        expect2(() => service.fromURL(context, 'lemon://self/a/b', {}), 'service,type,mode,body').toEqual({
            service: 'self',
            type: 'a',
            mode: 'GET',
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b', {}, null), 'service,type,mode,body').toEqual({
            service: 'self',
            type: 'a',
            mode: 'POST',
            body: null,
        });
        expect2(() => service.fromURL(context, 'lemon://self/a/b', {}, { a: 1 }), 'service,type,mode,body').toEqual({
            service: 'self',
            type: 'a',
            mode: 'POST',
            body: { a: 1 },
        });
    });

    //* for local stage
    it('should pass buildProtocolURI() w/ config (local)', async () => {
        const name = 'lemon-hello-api';
        const version = '1.2.3';
        const stage = 'local';

        const { service2 } = instance({ name, version, stage });
        expect2(service2.hello()).toEqual('protocol-service-test:lemon-hello-api');

        // with account-id
        const context: NextContext = { accountId: 'melon' };
        expect2(() => service2.myProtocolURI(context)).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context, '')).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a')).toEqual('api://melon@lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '')).toEqual('api://melon@lemon-hello-api-dev/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '', '')).toEqual('api://melon@lemon-hello-api-dev/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b')).toEqual('api://melon@lemon-hello-api-dev/a/b#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', '')).toEqual(
            'api://melon@lemon-hello-api-dev/a/b#1.2.3',
        );
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c')).toEqual(
            'api://melon@lemon-hello-api-dev/a/b/c#1.2.3',
        );
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c/d')).toEqual(
            'api://melon@lemon-hello-api-dev/a/b/c/d#1.2.3',
        );
        expect2(() => service2.myProtocolURI(context, 'a', 'b/c', 'd')).toEqual(
            'api://melon@lemon-hello-api-dev/a/b%2Fc/d#1.2.3',
        );

        // reverse url must be matched.
        expect2(() => service2.fromURL(context, service2.myProtocolURI(context, 'a')), '!mode').toEqual({
            service: name,
            stage: 'dev',
            type: 'a',
            id: null,
            cmd: null,
            context,
        });
        expect2(() => service2.fromURL(context, service2.myProtocolURI(context, 'a', 'b', 'c/d')), '!mode').toEqual({
            service: name,
            stage: 'dev',
            type: 'a',
            id: 'b',
            cmd: 'c/d',
            context,
        });
        expect2(() => service2.fromURL(context, service2.myProtocolURI(context, 'a', 'b/c', 'd')), '!mode').toEqual({
            service: name,
            stage: 'dev',
            type: 'a',
            id: 'b/c',
            cmd: 'd',
            context,
        });

        // without account-id
        const context2: NextContext = { accountId: '' };
        expect2(() => service2.myProtocolURI(context2)).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context2, '')).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a')).toEqual('api://lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a', '')).toEqual('api://lemon-hello-api-dev/a/#1.2.3');
    });

    //* for prod stage
    it('should pass buildProtocolURI() w/ config (local)', async () => {
        const name = 'lemon-hello-api';
        const version = '1.2.3';
        const stage = 'prod';

        const { service2 } = instance({ name, version, stage });
        expect2(service2.hello()).toEqual('protocol-service-test:lemon-hello-api');

        // with account-id
        const context: NextContext = { accountId: 'melon' };
        expect2(() => service2.myProtocolURI(context)).toEqual('api://melon@lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context, '')).toEqual('api://melon@lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a')).toEqual('api://melon@lemon-hello-api/a#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '')).toEqual('api://melon@lemon-hello-api/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '', '')).toEqual('api://melon@lemon-hello-api/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b')).toEqual('api://melon@lemon-hello-api/a/b#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', '')).toEqual('api://melon@lemon-hello-api/a/b#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c')).toEqual(
            'api://melon@lemon-hello-api/a/b/c#1.2.3',
        );
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c/d')).toEqual(
            'api://melon@lemon-hello-api/a/b/c/d#1.2.3',
        );
        expect2(() => service2.myProtocolURI(context, 'a', 'b/c', 'd')).toEqual(
            'api://melon@lemon-hello-api/a/b%2Fc/d#1.2.3',
        );

        // reversed-url should be matched. (and accountId should be recovered)
        const context1: NextContext = { accountId: '' };
        expect2(() => service2.fromURL(context1, service2.myProtocolURI(context, 'a')), '!mode').toEqual({
            service: name,
            stage: 'prod',
            type: 'a',
            id: null,
            cmd: null,
            context,
        });
        expect2(() => service2.fromURL(context1, service2.myProtocolURI(context, 'a', 'b', 'c/d')), '!mode').toEqual({
            service: name,
            stage: 'prod',
            type: 'a',
            id: 'b',
            cmd: 'c/d',
            context,
        });
        expect2(() => service2.fromURL(context1, service2.myProtocolURI(context, 'a', 'b/c', 'd')), '!mode').toEqual({
            service: name,
            stage: 'prod',
            type: 'a',
            id: 'b/c',
            cmd: 'd',
            context,
        });

        // without account-id
        const context2: NextContext = { accountId: '' };
        expect2(() => service2.myProtocolURI(context2)).toEqual('api://lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context2, '')).toEqual('api://lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a')).toEqual('api://lemon-hello-api/a#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a', '')).toEqual('api://lemon-hello-api/a/#1.2.3');
    });

    //* for local stage
    it('should pass asCallbackURI() w/ config (local)', async () => {
        const name = 'lemon-hello-api';
        const version = '1.2.3';
        const stage = 'local';

        const { service2 } = instance({ name, version, stage });
        expect2(service2.hello()).toEqual('protocol-service-test:lemon-hello-api');

        // with account-id
        const context: NextContext = { accountId: 'melon' };
        const cb = (type?: any, id?: any, cmd?: any): CallbackParam => ({ type, id, cmd });
        expect2(() => service2.asCallbackURI(context, cb())).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb(''))).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a'))).toEqual('api://melon@lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', ''))).toEqual('api://melon@lemon-hello-api-dev/a/#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', '', ''))).toEqual(
            'api://melon@lemon-hello-api-dev/a/#1.2.3',
        );
        expect2(() => service2.asCallbackURI(context, cb('a', 'b'))).toEqual(
            'api://melon@lemon-hello-api-dev/a/b#1.2.3',
        );
        expect2(() => service2.asCallbackURI(context, cb('a', 'b', ''))).toEqual(
            'api://melon@lemon-hello-api-dev/a/b#1.2.3',
        );
        expect2(() => service2.asCallbackURI(context, cb('a', 'b', 'c'))).toEqual(
            'api://melon@lemon-hello-api-dev/a/b/c#1.2.3',
        );
        expect2(() => service2.asCallbackURI(context, cb('a', 'b', 'c/d'))).toEqual(
            'api://melon@lemon-hello-api-dev/a/b/c/d#1.2.3',
        );
        expect2(() => service2.asCallbackURI(context, cb('a', 'b/c', 'd'))).toEqual(
            'api://melon@lemon-hello-api-dev/a/b%2Fc/d#1.2.3',
        );

        // reverse url must be matched.
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb('a'))), '!mode').toEqual({
            service: name,
            stage: 'dev',
            type: 'a',
            id: null,
            cmd: null,
            context,
        });
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb('a', 'b', 'c/d'))), '!mode').toEqual(
            { service: name, stage: 'dev', type: 'a', id: 'b', cmd: 'c/d', context },
        );
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb('a', 'b/c', 'd'))), '!mode').toEqual(
            { service: name, stage: 'dev', type: 'a', id: 'b/c', cmd: 'd', context },
        );

        // without account-id
        const context2: NextContext = { accountId: '' };
        expect2(() => service2.asCallbackURI(context2, cb())).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context2, cb(''))).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context2, cb('a'))).toEqual('api://lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.asCallbackURI(context2, cb('a', ''))).toEqual('api://lemon-hello-api-dev/a/#1.2.3');

        //* support with query string from callback.param.
        const param = { x: '', y: 1 };
        const cb2 = (t?: any, i?: any, c?: any) => ({ ...cb(t, i, c), param });
        expect2(() => service2.asCallbackURI(context, cb2('a'))).toEqual(
            'api://melon@lemon-hello-api-dev/a?x=&y=1#1.2.3',
        );
        expect2(() => service2.asCallbackURI(context, cb2('a', 'b'))).toEqual(
            'api://melon@lemon-hello-api-dev/a/b?x=&y=1#1.2.3',
        );

        const body = { z: 2 };
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb2('a')), null, body)).toEqual({
            service: name,
            stage: 'dev',
            type: 'a',
            id: null,
            cmd: null,
            context,
            mode: 'POST',
            param,
            body,
        });
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb2('a', 'b')), null, body)).toEqual({
            service: name,
            stage: 'dev',
            type: 'a',
            id: 'b',
            cmd: null,
            context,
            mode: 'POST',
            param,
            body,
        });
    });

    //* Test asPath with various scenarios
    it('should test asPath() static method', async () => {
        const asPath = MyProtocolService.asPath;

        //* Test with only type
        expect2(() => asPath('test')).toEqual('/test');
        expect2(() => asPath('')).toEqual('');

        //* Test with type and id
        expect2(() => asPath('test', 'abc')).toEqual('/test/abc');
        expect2(() => asPath('test', '')).toEqual('/test/');

        //* Test with type, id, and cmd
        expect2(() => asPath('test', 'abc', 'xyz')).toEqual('/test/abc/xyz');
        expect2(() => asPath('test', '', 'xyz')).toEqual('/test//xyz');

        //* Test encoding
        expect2(() => asPath('test', 'a b', 'c d')).toEqual('/test/a%20b/c%20d');
        expect2(() => asPath('test', 'a/b', 'c/d')).toEqual('/test/a%2Fb/c/d');
    });

    //* Test asTransformer with invalid name
    it('should return null for invalid transformer name', async () => {
        const { service } = instance();
        expect2(() => service.asTransformer('invalid' as any)).toEqual(null);
    });

    //* Test asProtocolURI with different stages
    it('should test asProtocolURI() with various stages', async () => {
        const { service } = instance({ STAGE: 'production' });
        const config = new MyConfigServiceTest({ STAGE: 'production', NAME: 'test' });

        const param = asParam('test-service', 'test-type');

        //* Production stage should not have -dev suffix
        const uri = service.asProtocolURI('sns', param, config);
        expect2(() => uri.includes('-dev')).toEqual(false);
    });

    //* Test service name handling in asProtocolURI
    it('should handle service name in asProtocolURI', async () => {
        const { service } = instance();
        const config = new MyConfigServiceTest({ STAGE: 'local', NAME: 'my-service' });
        const param = asParam('test-svc', 'test-type');

        const uri = service.asProtocolURI('web', param, config);
        expect2(() => uri.includes('test-svc')).toEqual(true);
    });

    //* Test fromURL with different protocols
    it('should test fromURL() with api protocol', async () => {
        const { service2 } = instance({ name: 'test-api', version: '1.0.0', stage: 'dev' });
        const context: NextContext = { accountId: 'test' };

        //* Test api:// protocol
        expect2(() => service2.fromURL(context, 'api://test-api-dev/type/id'), 'service,type,id').toEqual({
            service: 'test-api',
            type: 'type',
            id: 'id',
        });

        //* Test with version hash
        expect2(() => service2.fromURL(context, 'api://test-api-dev/type#1.0.0'), 'service,type').toEqual({
            service: 'test-api',
            type: 'type',
        });
    });

    //* Test fromURL with query parameters
    it('should test fromURL() with query parameters', async () => {
        const { service } = instance();
        const context: NextContext = {};

        //* Test with query string (qs library parses numbers as numbers)
        expect2(() => service.fromURL(context, 'lemon://self/type/id?x=1&y=2'), 'param').toEqual({
            param: { x: 1, y: 2 },
        });

        //* Test with string query params
        expect2(() => service.fromURL(context, 'lemon://self/type?name=test'), 'param').toEqual({
            param: { name: 'test' },
        });
    });

    //* Test myProtocolURI without version
    it('should test myProtocolURI() without version', async () => {
        const { service2 } = instance({ name: 'test-api', version: '', stage: 'dev' });
        const context: NextContext = { accountId: 'test' };

        //* Without version, should not have hash
        const uri = service2.myProtocolURI(context, 'type');
        expect2(() => uri.includes('#')).toEqual(true);
    });

    //* Test asCallbackURI with complex scenarios
    it('should test asCallbackURI() with param and body', async () => {
        const { service2 } = instance({ name: 'test-api', version: '1.0.0', stage: 'dev' });
        const context: NextContext = { accountId: 'test' };
        const callback: CallbackParam = { type: 'callback', id: 'cb-id', param: { x: 1 } };

        const uri = service2.asCallbackURI(context, callback);
        expect2(() => uri.includes('callback/cb-id')).toEqual(true);
        expect2(() => uri.includes('x=1')).toEqual(true);
    });

    //* Test hello() method
    it('should test hello() method', async () => {
        const { service } = instance();
        const result = service.hello();
        expect2(() => result).toEqual('protocol-service-test:lemon-hello-api');
    });

    //* Test original MyProtocolService hello() method
    it('should test original MyProtocolService hello() method', async () => {
        const { config } = instance();
        const original = new MyProtocolService('test-service', config);
        const result = original.hello();
        expect2(() => result).toEqual('protocol-service:test-service');
    });

    //* Test buildProtocolURI with missing service
    it('should throw error for missing service in buildProtocolURI', async () => {
        const { config } = instance();
        const context: NextContext = { accountId: 'test' };
        expect2(() =>
            MyProtocolService.buildProtocolURI(config, context, 'web', '', 'local', 'type', 'id', 'cmd'),
        ).toBe('@service (string) is required!');
    });

    //* Test transformEvent with invalid protocol
    it('should throw error for invalid protocol in transformEvent', async () => {
        const { service } = instance();
        const param = asParam('test-service', 'test-type');
        expect2(() => service.transformEvent('invalid://test', param)).toBe('400 INVALID PROTOCOL - protocol:invalid:');
    });

    //* Test fromURL with missing url
    it('should throw error for missing url in fromURL', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        expect2(() => service.fromURL(context, '')).toBe('@url (lemon-protocol) is required!');
    });

    //* Test fromURL with unsupported protocol
    it('should throw error for unsupported protocol in fromURL', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        expect2(() => service.fromURL(context, 'https://example.com')).toBe(
            '@url - protocol not supportable (https://)',
        );
    });

    //* Test fromURL with api:// protocol
    it('should test fromURL() with api:// protocol', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        const result = service.fromURL(context, 'api://hello-api/test/123');
        expect2(() => result.service).toEqual('hello-api');
        expect2(() => result.type).toEqual('test');
        expect2(() => result.id).toEqual('123');
    });

    //* Test fromURL with api:// -dev stage
    it('should test fromURL() with api://-dev stage detection', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        const result = service.fromURL(context, 'api://hello-api-dev/test/123');
        expect2(() => result.stage).toEqual('dev');
    });

    //* Test fromURL with cmd parameter
    it('should test fromURL() with cmd parameter', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        const result = service.fromURL(context, 'lemon://self/test/123/command');
        expect2(() => result.type).toEqual('test');
        expect2(() => result.id).toEqual('123');
        expect2(() => result.cmd).toEqual('command');
    });

    //* Test fromURL with body parameter
    it('should test fromURL() with body parameter', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        const result = service.fromURL(context, 'lemon://self/test', undefined, { data: 'test' });
        expect2(() => result.mode).toEqual('POST');
        expect2(() => result.body).toEqual({ data: 'test' });
    });

    //* Test fromURL with auth in URL
    it('should test fromURL() with auth in URL', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        const result = service.fromURL(context, 'lemon://account123@self/test/123');
        expect2(() => result.context.accountId).toEqual('account123');
    });

    //* Test execute() with mocked Lambda
    it('should test execute() with mocked Lambda client', async () => {
        const { service, config } = instance();
        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });

        const result: any = await service.execute(param, config);
        expect2(() => typeof result).toEqual('object');
        expect2(() => result.message).toEqual('mock-lambda-success');
    });

    //* Test notify() with mocked SNS
    it('should test notify() with mocked SNS client', async () => {
        const { service, config } = instance();
        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });

        const messageId = await service.notify(param, undefined, config);
        expect2(() => typeof messageId).toEqual('string');
        expect2(() => messageId.startsWith('mock-message-id')).toEqual(true);
    });

    //* Test notify() with callback
    it('should test notify() with callback parameter', async () => {
        const { service, config } = instance();
        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });
        const callback: CallbackParam = { type: 'callback', id: 'cb-id' };

        const messageId = await service.notify(param, callback, config);
        expect2(() => typeof messageId).toEqual('string');
        expect2(() => messageId.startsWith('mock-message-id')).toEqual(true);
    });

    //* Test enqueue() with mocked SQS
    it('should test enqueue() with mocked SQS client', async () => {
        const { service, config } = instance();
        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });

        const queueId = await service.enqueue(param, undefined, 10, config);
        expect2(() => typeof queueId).toEqual('string');
        expect2(() => queueId.startsWith('mock-message')).toEqual(true);
    });

    //* Test enqueue() with callback
    it('should test enqueue() with callback parameter', async () => {
        const { service, config } = instance();
        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });
        const callback: CallbackParam = { type: 'callback', id: 'cb-id' };

        const queueId = await service.enqueue(param, callback, 0, config);
        expect2(() => typeof queueId).toEqual('string');
        expect2(() => queueId.startsWith('mock-message')).toEqual(true);
    });

    //* Test enqueue() with negative delaySeconds
    it('should throw error for negative delaySeconds in enqueue()', async () => {
        const { service, config } = instance();
        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });

        expect2(await service.enqueue(param, undefined, -1, config).catch(GETERR)).toEqual(
            '@delaySeconds (number) should be >= 0. but -1',
        );
    });

    //* Test broadcast() with mocked SNS
    it('should test broadcast() with mocked SNS client', async () => {
        const { service } = instance({ STAGE: 'dummy' });
        const context: NextContext = { accountId: 'acc123', requestId: 'req123' };
        const awsMock = jest.requireMock('../aws/');
        const endpointMock = awsMock.sns.endpoint as jest.Mock;
        endpointMock.mockResolvedValueOnce('arn:aws:sns:ap-northeast-2:123456789012:mock-broadcast');

        const messageId = await service.broadcast(context, 'test-topic', { message: 'test-broadcast' });
        expect2(() => typeof messageId).toEqual('string');
        expect2(() => endpointMock.mock.calls[0][0]).toEqual('test-topic');
    });

    //* Test asPath with id and cmd
    it('should test asPath() with id and cmd parameters', async () => {
        const path = MyProtocolService.asPath('type', 'id123', 'command');
        expect2(() => path).toEqual('/type/id123/command');
    });

    //* Test asPath with special characters
    it('should test asPath() with special characters', async () => {
        const path = MyProtocolService.asPath('type', 'id/123', 'cmd');
        expect2(() => path.includes('id%2F123')).toEqual(true);
    });

    //* Test asProtocolURI with different stages
    it('should test asProtocolURI() with develop stage', async () => {
        const { service, config } = instance({ STAGE: 'dev' });
        const param = asParam('test-service', 'test-type');
        const uri = service.asProtocolURI('web', param, config);
        expect2(() => typeof uri).toEqual('string');
        expect2(() => uri.startsWith('web://')).toEqual(true);
    });

    //* Test myProtocolURI with all parameters
    it('should test myProtocolURI() with type, id, cmd', async () => {
        const { service } = instance({ name: 'my-service', version: '1.0', stage: 'prod' });
        const context: NextContext = { accountId: 'acc123' };
        const uri = service.myProtocolURI(context, 'type', 'id', 'cmd');
        expect2(() => uri.includes('/type/id/cmd')).toEqual(true);
    });

    //* Test WEB transformer error: null event
    it('should throw error for null event in WEB transformToParam', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        expect2(() => service.web.transformToParam(null as any, context)).toBe(
            '@event (API Event) is required - web.transformToParam()',
        );
    });

    //* Test WEB transformer error: missing headers
    it('should throw error for missing headers in WEB transformToParam', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        const event: any = { path: '/test' };
        expect2(() => service.web.transformToParam(event, context)).toBe(
            '.headers (object) is required - web.transformToParam(/test)',
        );
    });

    //* Test WEB transformer error: missing requestContext
    it('should throw error for missing requestContext in WEB transformToParam', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test' };
        const event: any = { path: '/test', headers: {} };
        expect2(() => service.web.transformToParam(event, context)).toBe(
            '.requestContext (object) is required - web.transformToParam(/test)',
        );
    });

    //* Test SQS transformer error: missing subject
    it('should throw error for missing subject in SQS transformToParam', async () => {
        const { service } = instance();
        const sqsRecord: any = {
            body: JSON.stringify({ type: 'test' }),
            messageAttributes: {},
        };
        expect2(() => service.sqs.transformToParam(sqsRecord)).toBe('.subject[undefined] is not valid protocol.');
    });

    //* Test asPath with cmd but no id
    it('should test asPath() with cmd but no id', async () => {
        const path = MyProtocolService.asPath('type', undefined, 'command');
        expect2(() => path).toEqual('/type//command');
    });

    //* Test SNS transformEvent
    it('should test SNS transformEvent()', async () => {
        const { service, config } = instance();
        const context: NextContext = { accountId: 'acc123', requestId: 'req123' };
        const param = asParam('test-service', 'test-type', { id: 'test-id', context });

        const uri = service.asProtocolURI('sns', param, config);
        const event = service.transformEvent(uri, param) as any;

        expect2(() => typeof event).toEqual('object');
        expect2(() => event.TopicArn).toEqual(expect.any(String));
        expect2(() => event.Subject).toEqual('x-protocol-service');
    });

    //* Test SQS transformEvent
    it('should test SQS transformEvent()', async () => {
        const { service, config } = instance();
        const context: NextContext = { accountId: 'acc123', requestId: 'req123' };
        const param = asParam('test-service', 'test-type', { id: 'test-id', context });

        const uri = service.asProtocolURI('sqs', param, config);
        const event = service.transformEvent(uri, param) as any;

        expect2(() => typeof event).toEqual('object');
        expect2(() => event.QueueUrl).toEqual(expect.any(String));
        expect2(() => event.MessageBody).toEqual(expect.any(String));
    });

    //* Test doReportError with REPORT_ERROR enabled
    it('should test doReportError() with REPORT_ERROR enabled', async () => {
        const { service } = instance();
        const originalReportError = MyProtocolService.REPORT_ERROR;
        MyProtocolService.REPORT_ERROR = true;
        const testError = new Error('test-error');

        const result = await (service as any).doReportError(testError, {}, {}, {}).catch(GETERR);
        expect2(() => result).toEqual('test-error');

        MyProtocolService.REPORT_ERROR = originalReportError;
    });

    //* Test execute() with different statusCodes
    it('should test execute() with statusCode 201', async () => {
        const { service, config } = instance();

        // Override Lambda mock to return 201
        const originalMock = jest.requireMock('@aws-sdk/client-lambda').LambdaClient;
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                StatusCode: 201,
                Payload: new TextEncoder().encode(
                    JSON.stringify({
                        statusCode: 201,
                        body: JSON.stringify({ success: true }),
                    }),
                ),
            }),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id' });
        const result: any = await service.execute(param, config);
        expect2(() => result.success).toEqual(true);

        // Restore
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = originalMock;
    });

    //* Test execute() with statusCode 404
    it('should test execute() with statusCode 404', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-lambda').LambdaClient;
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                StatusCode: 200,
                Payload: new TextEncoder().encode(
                    JSON.stringify({
                        statusCode: 404,
                        body: JSON.stringify('Resource not found'),
                    }),
                ),
            }),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id' });
        expect2(await service.execute(param, config).catch(GETERR)).toEqual('Resource not found');

        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = originalMock;
    });

    //* Test execute() with statusCode 400
    it('should test execute() with statusCode 400', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-lambda').LambdaClient;
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                StatusCode: 200,
                Payload: new TextEncoder().encode(
                    JSON.stringify({
                        statusCode: 400,
                        body: JSON.stringify({ error: 'Bad request' }),
                    }),
                ),
            }),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id' });
        expect2(await service.execute(param, config).catch(GETERR)).toEqual('{"error":"Bad request"}');

        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = originalMock;
    });

    //* Test execute() with statusCode 500
    it('should test execute() with statusCode 500', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-lambda').LambdaClient;
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                StatusCode: 200,
                Payload: new TextEncoder().encode(
                    JSON.stringify({
                        statusCode: 500,
                        body: JSON.stringify({ error: 'Internal error' }),
                    }),
                ),
            }),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id' });
        expect2(await service.execute(param, config).catch(GETERR)).toEqual('{"error":"Internal error"}');

        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = originalMock;
    });

    //* Test execute() with text response
    it('should test execute() with text payload', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-lambda').LambdaClient;
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                StatusCode: 200,
                Payload: new TextEncoder().encode(
                    JSON.stringify({
                        statusCode: 200,
                        text: 'plain text response',
                    }),
                ),
            }),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id' });
        const result = await service.execute(param, config);
        expect2(() => result).toEqual('plain text response');

        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = originalMock;
    });

    //* Test execute() with 404 NOT FOUND string
    it('should test execute() with 404 NOT FOUND string body', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-lambda').LambdaClient;
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                StatusCode: 200,
                Payload: new TextEncoder().encode(
                    JSON.stringify({
                        statusCode: 500,
                        body: '404 NOT FOUND - /test/path',
                    }),
                ),
            }),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id' });
        expect2(await service.execute(param, config).catch(GETERR)).toEqual('404 NOT FOUND - /test/path');

        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = originalMock;
    });

    //* Test execute() with Lambda invocation error
    it('should test execute() with Lambda invocation error', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-lambda').LambdaClient;
        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockRejectedValue(new Error('Lambda invocation failed')),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id' });
        expect2(await service.execute(param, config).catch(GETERR)).toEqual('Lambda invocation failed');

        jest.requireMock('@aws-sdk/client-lambda').LambdaClient = originalMock;
    });

    //* Test notify() with error handling
    it('should test notify() error handling', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-sns').SNSClient;
        jest.requireMock('@aws-sdk/client-sns').SNSClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockRejectedValue(new Error('SNS Error')),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });
        expect2(await service.notify(param, undefined, config).catch(GETERR)).toEqual('SNS Error');

        jest.requireMock('@aws-sdk/client-sns').SNSClient = originalMock;
    });

    //* Test enqueue() with error handling
    it('should test enqueue() error handling', async () => {
        const { service, config } = instance();

        const originalMock = jest.requireMock('@aws-sdk/client-sqs').SQSClient;
        jest.requireMock('@aws-sdk/client-sqs').SQSClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockRejectedValue(new Error('SQS Error')),
        }));

        const param = asParam('test-service', 'test-type', { id: 'test-id', context: { accountId: 'acc123' } });
        expect2(await service.enqueue(param, undefined, 0, config).catch(GETERR)).toEqual('SQS Error');

        jest.requireMock('@aws-sdk/client-sqs').SQSClient = originalMock;
    });

    //* Test broadcast() with error handling
    it('should test broadcast() error handling', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'acc123', requestId: 'req123' };

        const originalMock = jest.requireMock('@aws-sdk/client-sns').SNSClient;
        jest.requireMock('@aws-sdk/client-sns').SNSClient = jest.fn().mockImplementation(() => ({
            send: jest.fn().mockRejectedValue(new Error('Broadcast Error')),
        }));

        const originalReportError = MyProtocolService.REPORT_ERROR;
        MyProtocolService.REPORT_ERROR = false;
        expect2(await service.broadcast(context, 'test-topic', { data: 'test' }).catch(GETERR)).toEqual(
            'Broadcast Error',
        );
        MyProtocolService.REPORT_ERROR = originalReportError;

        jest.requireMock('@aws-sdk/client-sns').SNSClient = originalMock;
    });

    //* Test WEB transformToParam with no context in header
    it('should test WEB transformToParam() with no context in header', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'test', requestId: 'req123' };

        const param = asParam('test-service', 'test-type', { id: 'test-id', context: {} });
        const uri = service.asProtocolURI('web', param, new MyConfigServiceTest({ STAGE: 'local' }));
        const event = service.transformEvent(uri, param) as APIGatewayProxyEvent;

        // Remove context header
        event.headers = {};
        event.requestContext.accountId = 'test';
        event.requestContext.requestId = 'req123';

        const result = service.web.transformToParam(event, context);
        expect2(() => result.context).toEqual(context);
    });

    //* Test WEB transformToParam with invalid context type
    it('should throw error for invalid context type in WEB transformToParam', async () => {
        const { service } = instance();

        const event: any = {
            path: '/test',
            headers: {
                'x-protocol-context': 123, // Invalid type
            },
            requestContext: {
                accountId: 'test',
                requestId: 'req123',
                httpMethod: 'GET',
                path: '/test',
            },
        };

        expect2(() => service.web.transformToParam(event)).toBe(
            '@context (NextContext) should be string - web.transformToParam(/test)',
        );
    });

    //* Test WEB transformToParam with invalid JSON context
    it('should throw error for invalid JSON context in WEB transformToParam', async () => {
        const { service } = instance();

        const event: any = {
            path: '/test',
            headers: {
                'x-protocol-context': '{invalid json',
            },
            requestContext: {
                accountId: 'test',
                requestId: 'req123',
                httpMethod: 'GET',
                path: '/test',
            },
        };

        expect2(() => service.web.transformToParam(event)).toBe(
            '@context[{invalid json] is not valid JSON - web.transformToParam(/test)',
        );
    });

    //* Test WEB transformToParam with non-object context
    it('should test WEB transformToParam() with non-object JSON context', async () => {
        const { service } = instance();

        const event: any = {
            path: '/test',
            headers: {
                'x-protocol-context': '"string value"',
            },
            requestContext: {
                accountId: 'test',
                requestId: 'req123',
                httpMethod: 'GET',
                path: '/test',
            },
        };

        expect2(() => service.web.transformToParam(event)).toBe(
            '@context (NextContext) is required - web.transformToParam(/test)',
        );
    });

    //* Test SNS transformToParam full coverage
    it('should test SNS transformToParam() with full coverage', async () => {
        const { service } = instance();
        const context: NextContext = { accountId: 'acc123', requestId: 'req123' };

        const snsMessage: any = {
            Subject: 'x-protocol-service',
            Message: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                id: 'test-id',
                context: context,
            }),
            MessageAttributes: {
                accountId: { Value: 'acc123' },
                requestId: { Value: 'req123' },
                callback: { Value: 'api://callback-url' },
            },
        };

        const result = service.sns.transformToParam(snsMessage);
        expect2(() => result.service).toEqual('test-service');
        expect2(() => result.type).toEqual('test-type');
        expect2(() => result.id).toEqual('test-id');
        expect2(() => result.callback).toEqual('api://callback-url');
    });

    //* Test SNS transformToParam with invalid accountId
    it('should throw error for invalid accountId in SNS transformToParam', async () => {
        const { service } = instance();

        const snsMessage: any = {
            Subject: 'x-protocol-service',
            Message: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                context: { accountId: 'acc123', requestId: 'req123' },
            }),
            MessageAttributes: {
                accountId: { Value: 'wrong-account' },
                requestId: { Value: 'req123' },
            },
        };

        expect2(() => service.sns.transformToParam(snsMessage)).toBe('400 INVALID CONTEXT - accountId:acc123');
    });

    //* Test SNS transformToParam with invalid requestId
    it('should throw error for invalid requestId in SNS transformToParam', async () => {
        const { service } = instance();

        const snsMessage: any = {
            Subject: 'x-protocol-service',
            Message: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                context: { accountId: 'acc123', requestId: 'req123' },
            }),
            MessageAttributes: {
                accountId: { Value: 'acc123' },
                requestId: { Value: 'wrong-request' },
            },
        };

        expect2(() => service.sns.transformToParam(snsMessage)).toBe('400 INVALID CONTEXT - requestId:req123');
    });

    //* Test SNS transformToParam without MessageAttributes
    it('should test SNS transformToParam() without MessageAttributes', async () => {
        const { service } = instance();

        const snsMessage: any = {
            Subject: 'x-protocol-service',
            Message: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                context: {},
            }),
            MessageAttributes: null,
        };

        const result = service.sns.transformToParam(snsMessage);
        expect2(() => result.service).toEqual('test-service');
        expect2(() => result.callback).toEqual(undefined);
    });

    //* Test SQS transformToParam with full coverage
    it('should test SQS transformToParam() with full coverage', async () => {
        const { service } = instance();

        const sqsRecord: any = {
            body: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                id: 'test-id',
                context: { accountId: 'acc123', requestId: 'req123' },
            }),
            messageAttributes: {
                Subject: { stringValue: 'x-protocol-service' },
                accountId: { stringValue: 'acc123' },
                requestId: { stringValue: 'req123' },
                callback: { stringValue: 'api://callback-url' },
            },
        };

        const result = service.sqs.transformToParam(sqsRecord);
        expect2(() => result.service).toEqual('test-service');
        expect2(() => result.type).toEqual('test-type');
        expect2(() => result.id).toEqual('test-id');
        expect2(() => result.callback).toEqual('api://callback-url');
    });

    //* Test SQS transformToParam with invalid accountId
    it('should throw error for invalid accountId in SQS transformToParam', async () => {
        const { service } = instance();

        const sqsRecord: any = {
            body: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                context: { accountId: 'acc123', requestId: 'req123' },
            }),
            messageAttributes: {
                Subject: { stringValue: 'x-protocol-service' },
                accountId: { stringValue: 'wrong-account' },
                requestId: { stringValue: 'req123' },
            },
        };

        expect2(() => service.sqs.transformToParam(sqsRecord)).toBe('400 INVALID CONTEXT - accountId:acc123');
    });

    //* Test SQS transformToParam with invalid requestId
    it('should throw error for invalid requestId in SQS transformToParam', async () => {
        const { service } = instance();

        const sqsRecord: any = {
            body: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                context: { accountId: 'acc123', requestId: 'req123' },
            }),
            messageAttributes: {
                Subject: { stringValue: 'x-protocol-service' },
                accountId: { stringValue: 'acc123' },
                requestId: { stringValue: 'wrong-request' },
            },
        };

        expect2(() => service.sqs.transformToParam(sqsRecord)).toBe('400 INVALID CONTEXT - requestId:req123');
    });

    //* Test SQS transformToParam without context
    it('should test SQS transformToParam() without context', async () => {
        const { service } = instance();

        const sqsRecord: any = {
            body: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                context: null,
            }),
            messageAttributes: {
                Subject: { stringValue: 'x-protocol-service' },
                accountId: { stringValue: 'acc123' },
                requestId: { stringValue: 'req123' },
            },
        };

        const result = service.sqs.transformToParam(sqsRecord);
        expect2(() => result.service).toEqual('test-service');
        expect2(() => result.type).toEqual('test-type');
    });

    //* Test SQS transformToParam without messageAttributes
    it('should test SQS transformToParam() without messageAttributes', async () => {
        const { service } = instance();

        const sqsRecord: any = {
            body: JSON.stringify({
                service: 'test-service',
                type: 'test-type',
                context: {},
            }),
            messageAttributes: {
                Subject: { stringValue: 'x-protocol-service' },
            },
        };

        const result = service.sqs.transformToParam(sqsRecord);
        expect2(() => result.service).toEqual('test-service');
        expect2(() => result.callback).toEqual(undefined);
    });
});

describe('Module index integrations', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('should expose cache services via cache index', async () => {
        const cacheIndex = (await import('../cache')) as any;
        expect2(() => typeof cacheIndex.CacheService).toEqual('function');
    });

    it('should provide default protocol module instance', async () => {
        const mod = await import('./index');
        const svc = mod.default.service as any;
        expect2(() => mod.default.getModuleName()).toEqual('protocol');
        expect2(() => typeof svc).toEqual('object');
        expect2(() => typeof svc.hello).toEqual('function');
    });

    it('should init ProtocolModule with injected engine', async () => {
        const { ProtocolModule } = await import('./index');
        const register = jest.fn();
        const configInit = jest.fn().mockResolvedValue(5);
        const moduleFn = jest.fn().mockReturnValue({ initModule: configInit });
        const customEngine = { register, module: moduleFn } as any;
        const mod = new ProtocolModule(customEngine);
        expect2(await mod.initModule()).toEqual(6);
        expect2(() => register.mock.calls.length).toEqual(1);
        expect2(() => moduleFn.mock.calls.length).toEqual(1);
    });

    it('should resolve to 1 when config module missing', async () => {
        const { ProtocolModule } = await import('./index');
        const customEngine = {
            register: jest.fn(),
            module: jest.fn().mockReturnValue(undefined),
        } as any;
        const mod = new ProtocolModule(customEngine);
        expect2(await mod.initModule()).toEqual(1);
    });

    it('should expose config module service via config index', async () => {
        const configIndex = await import('../config');
        expect2(() => typeof configIndex.default.config).toEqual('object');
        expect2(() => configIndex.default.getModuleName()).toEqual('config');
    });

    it('should init ConfigModule via AWS module when level undefined', async () => {
        const { ConfigModule } = await import('../config');
        const register = jest.fn();
        const awsInit = jest.fn().mockResolvedValue(4);
        const awsModule = { initModule: awsInit, kms: { encrypt: jest.fn() } };
        const moduleFn = jest.fn().mockReturnValue(awsModule);
        const customEngine = { register, module: moduleFn } as any;
        const configModule = new ConfigModule(customEngine);
        const result = await configModule.initModule();
        expect2(() => result).toEqual(5);
        expect2(() => moduleFn.mock.calls[0][0]).toEqual('aws');
        expect2(() => register.mock.calls.length).toEqual(1);
    });

    it('should attach aws kms when initModule receives level', async () => {
        const { ConfigModule } = await import('../config');
        const register = jest.fn();
        const awsModule = { initModule: jest.fn(), kms: { encrypt: jest.fn() } };
        const moduleFn = jest.fn().mockReturnValue(awsModule);
        const customEngine = { register, module: moduleFn } as any;
        const configModule = new ConfigModule(customEngine);
        const initSpy = jest.spyOn(configModule.config, 'init').mockResolvedValue(undefined as any);
        await configModule.initModule(0);
        expect2(() => configModule.config.kms).toEqual(awsModule.kms);
        expect2(() => initSpy.mock.calls.length).toEqual(1);
        initSpy.mockRestore();
    });

    it('should construct lambda module and initialize engine before handling', async () => {
        const register = jest.fn();
        const initialize = jest.fn().mockResolvedValue(undefined);
        const moduleFn = jest.fn().mockReturnValue(undefined);
        const engine = { register, initialize, module: moduleFn } as any;

        await withLambdaModuleEngine(engine, async ({ LambdaModule }) => {
            const mod = new LambdaModule(engine);
            await mod.lambda.handle({ evt: 1 }, { ctx: 'x' } as any);
            expect2(() => register.mock.calls.length >= 1).toEqual(true);
            const registeredModule = register.mock.calls[register.mock.calls.length - 1][0];
            expect2(() => registeredModule).toEqual(mod);
            expect2(() => initialize.mock.calls.length).toEqual(1);
            const { LambdaHandler } = jest.requireMock('../lambda/lambda-handler');
            expect2(() => LambdaHandler.handleMock.mock.calls[0]).toEqual([{ evt: 1 }, { ctx: 'x' }]);
            const { LambdaALBHandler } = jest.requireMock('../lambda/lambda-alb-handler');
            expect2(() => LambdaALBHandler.instances[0].args).toEqual([mod.lambda, true]);
        });
    });

    it('should init lambda module via config module when level undefined', async () => {
        const register = jest.fn();
        const initialize = jest.fn().mockResolvedValue(undefined);
        const configInit = jest.fn().mockResolvedValue(2);
        const moduleFn = jest.fn().mockReturnValue({ initModule: configInit });
        const engine = { register, initialize, module: moduleFn } as any;

        await withLambdaModuleEngine(engine, async ({ LambdaModule }) => {
            const mod = new LambdaModule(engine);
            expect2(await mod.initModule()).toEqual(3);
            expect2(() => configInit.mock.calls.length).toEqual(1);
        });
    });

    it('should attach config when initModule is called with explicit level', async () => {
        const register = jest.fn();
        const initialize = jest.fn().mockResolvedValue(undefined);
        const configModule = { initModule: jest.fn(), config: { secret: 'value' } };
        const moduleFn = jest.fn().mockReturnValue(configModule);
        const engine = { register, initialize, module: moduleFn } as any;

        await withLambdaModuleEngine(engine, async ({ LambdaModule }) => {
            const mod = new LambdaModule(engine);
            await mod.initModule(0);
            expect2(() => mod.lambda.config).toEqual(configModule.config);
        });
    });
});
