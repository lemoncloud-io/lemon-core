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
import { expect2, GETERR, environ } from '../../common/test-helper';
import { credentials } from '../../tools/';
import {
    MyProtocolService,
    WEBProtocolTransformer,
    SNSProtocolTransformer,
    SQSProtocolTransformer,
} from './protocol-service';
import { MyConfigService, ConfigService } from './../config/config-service';
import { NextContext } from './../core-types';
import { ProtocolParam, STAGE, CallbackParam } from './../core-services';
import { APIGatewayProxyEvent } from 'aws-lambda';

const DEF_SERVICE = 'lemon-hello-api';

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

export const instance = (env?: { [key: string]: string }) => {
    env = { STAGE: 'local', NAME: 'test', ...env };
    const config = new MyConfigServiceTest(env);
    const config2 = new MyConfigServiceTest2(env);
    const service = new MyProtocolServiceTest();
    const service2 = new MyProtocolServiceTest(config2);
    return { service, config, service2, config2 };
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

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('ProtocolService', () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

    //! dummy service.
    it('should pass basic protocol', async done => {
        const { service, config } = instance();
        /* eslint-disable prettier/prettier */
        expect2(()=>{ throw new Error('HI Error') }).toBe('HI Error');
        expect2(service.hello()).toEqual('protocol-service-test:lemon-hello-api');
        expect2(config.hello()).toEqual('config-service-test:local');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! transformer
    it('should pass asTransformer()', async done => {
        const { service } = instance();
        expect2(service.asTransformer('web') instanceof WEBProtocolTransformer).toBe(true);
        expect2(service.asTransformer('sns') instanceof SNSProtocolTransformer).toBe(true);
        expect2(service.asTransformer('sqs') instanceof SQSProtocolTransformer).toBe(true);
        done();
    });

    //! in local environ.
    it('should pass asServiceURI() w/ local', async done => {
        const { service, config } = instance();
        /* eslint-disable prettier/prettier */
        expect2(config.hello()).toEqual('config-service-test:local');

        //! as standard format name.
        expect2(service.asProtocolURI('web', asParam(''), config)).toEqual('web://lemon-hello-api-dev-lambda');
        expect2(service.asProtocolURI('sns', asParam('self'), config)).toEqual('sns://lemon-hello-sns-dev');
        expect2(service.asProtocolURI('sqs', asParam(''), config)).toEqual('sqs://lemon-hello-sqs-dev');

        //! as non-standard format.
        expect2(service.asProtocolURI('web', asParam('lemon-lambda'), config)).toEqual('web://lemon-lambda-dev-lambda');
        expect2(service.asProtocolURI('sns', asParam('lemon-lambda'), config)).toEqual('sns://lemon-lambda-dev');
        expect2(service.asProtocolURI('sqs', asParam('lemon-lambda'), config)).toEqual('sqs://lemon-lambda-dev');

        //! check path. (id should be encoded)
        expect2(service.asProtocolURI('sqs', asParam('', 'test'), config)).toEqual('sqs://lemon-hello-sqs-dev/test');
        expect2(service.asProtocolURI('sqs', asParam('', 'test/0'), config)).toEqual('sqs://lemon-hello-sqs-dev/test%2F0');
        expect2(service.asProtocolURI('sqs', asParam('', 'test 0'), config)).toEqual('sqs://lemon-hello-sqs-dev/test%200');

        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'1' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/1');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'', cmd:'' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'1', cmd:'2' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/1/2');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'', cmd:'2' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test//2');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'1', cmd:'2/3' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/1/2/3');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'1/2', cmd:'3' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/1%2F2/3');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! in develop environ.
    it('should pass asServiceURI() w/ develop', async done => {
        const { service, config } = instance({ STAGE: 'develop' });
        /* eslint-disable prettier/prettier */
        expect2(config.hello()).toEqual('config-service-test:dev');

        //! as standard format name.
        expect2(service.asProtocolURI('web', asParam(''), config)).toEqual('web://lemon-hello-api-dev-lambda');
        expect2(service.asProtocolURI('sns', asParam(''), config)).toEqual('sns://lemon-hello-sns-dev');
        expect2(service.asProtocolURI('sqs', asParam('self'), config)).toEqual('sqs://lemon-hello-sqs-dev');

        //! as non-standard format.
        const param2 = asParam('lemon-lambda');
        param2.context.accountId = '1122';
        expect2(service.asProtocolURI('web', param2, config)).toEqual('web://1122@lemon-lambda-dev-lambda');
        expect2(service.asProtocolURI('sns', param2, config)).toEqual('sns://1122@lemon-lambda-dev');
        expect2(service.asProtocolURI('sqs', param2, config)).toEqual('sqs://1122@lemon-lambda-dev');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! in production environ.
    it('should pass asServiceURI() w/ production', async done => {
        const { service, config } = instance({ STAGE: 'production' });
        /* eslint-disable prettier/prettier */
        expect2(config.hello()).toEqual('config-service-test:prod');

        //! as standard format name.
        expect2(service.asProtocolURI('web', asParam('self'), config)).toEqual('web://lemon-hello-api-prod-lambda');
        expect2(service.asProtocolURI('sns', asParam(''), config)).toEqual('sns://lemon-hello-sns');
        expect2(service.asProtocolURI('sqs', asParam(''), config)).toEqual('sqs://lemon-hello-sqs');

        //! as non-standard format.
        const param2 = asParam('lemon-web');
        expect2(service.asProtocolURI('web', param2, config)).toEqual('web://lemon-web-prod-lambda');
        expect2(service.asProtocolURI('sns', param2, config)).toEqual('sns://lemon-web');
        expect2(service.asProtocolURI('sqs', param2, config)).toEqual('sqs://lemon-web');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! for each event protocol
    it('should pass transformEvent() of web.local', async done => {
        const { service, config } = instance();
        /* eslint-disable prettier/prettier */
        const id = 'abc';
        const param = asParam('', 'test', { id });
        const uri = service.asProtocolURI('web', param, config);
        expect2(uri).toEqual('web://lemon-hello-api-dev-lambda/test/abc');
        expect2(service.transformEvent(uri, param), 'headers').toEqual({ headers:{ "x-protocol-context": "{}" }});
        expect2(service.transformEvent(uri, param), 'httpMethod,path').toEqual({ httpMethod:'GET', path:'/test/abc' });
        expect2(service.transformEvent(uri, param), 'pathParameters').toEqual({ pathParameters:{ id, cmd:'' } });
        const requestContext = { accountId: '', httpMethod: 'GET', identity: null as any, path: '/test/abc', requestId: '', stage: '' };
        expect2(service.transformEvent(uri, param), 'requestContext').toEqual({ requestContext });

        //! now verify with real lambda call.
        if (PROFILE == 'lemon') {
            expect2(await service.execute(param).catch(GETERR)).toEqual('Function not found: arn:aws:lambda:ap-northeast-2:085403634746:function:lemon-hello-api-dev-lambda');
        }

        /* eslint-enable prettier/prettier */
        done();
    });

    //! for each event protocol
    it('should pass transformEvent() of web.dev', async done => {
        const { service, config } = instance({ STAGE: 'develop' });
        /* eslint-disable prettier/prettier */
        const context: NextContext = { requestId:'xxxx', accountId:'0908' };
        const id = '0';
        const param = asParam('lemon-metrics-api', 'metrics', { id, param:{ ns:'TestTable', id:'abc-123', type:'TEST', ts:1567052044463 }, context });
        const uri = service.asProtocolURI('web', param, config);
        const path = '/metrics/0';
        expect2(uri).toEqual('web://0908@lemon-metrics-api-dev-lambda/metrics/0');
        expect2(service.transformEvent(uri, param), 'headers').toEqual({ headers:{ "x-protocol-context": JSON.stringify(context) }});
        expect2(service.transformEvent(uri, param), 'httpMethod,path').toEqual({ httpMethod:'GET', path });
        expect2(service.transformEvent(uri, param), 'pathParameters').toEqual({ pathParameters:{ id, cmd:'' } });
        const requestContext = { accountId: '0908', httpMethod: 'GET', identity: null as any, path, requestId: 'xxxx', stage: '' };
        expect2(service.transformEvent(uri, param), 'requestContext').toEqual({ requestContext });

        //! now verify with real lambda call.
        if (PROFILE == 'comics') {
            // expect2(await service.execute(param, config).catch(GETERR)).toEqual('@ns is required!');
            // expect2(await service.execute(param, config).catch(GETERR)).toEqual('@id is required!');
            expect2(await service.execute(param, config).catch(GETERR)).toEqual('404 NOT FOUND - @id:TestTable_abc-123_TEST/1567052044463');
            const testData: any = await service.execute({...param, cmd:'test-load-data'}, config);
            expect2(() => testData[0], 'item').toEqual({ item: { count: 1, id: 'abc-123', name: 'abc 1' } });
        }

        //! test with transformToParam()
        const event2 = service.transformEvent(uri, param) as APIGatewayProxyEvent;
        const param2 = service.web.transformToParam(event2);
        expect2(param2, 'service,stage,type').toEqual({ service:'', stage:'', type:'metrics' });
        expect2(param2, 'mode,id,cmd').toEqual({ mode:'GET', id, cmd:'' });
        expect2(param2, 'param').toEqual({ param:{ ns:'TestTable', id:'abc-123', type:'TEST', ts:1567052044463 } });
        expect2(param2, 'body').toEqual({ body:null });
        expect2(param2.context).toEqual(context);

        //! test of body-data.
        const webhdr0 = { 'content-type':'', 'x-protocol-context':'' };
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr0 }, body:'' }), 'body').toEqual({ body:'' });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr0 }, body:null }), 'body').toEqual({ body:null });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr0 }, body:{} as any }), 'body').toEqual({ body:{} });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr0 }, body:'{}' }), 'body').toEqual({ body:{} });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr0 }, body:'[]' }), 'body').toEqual({ body:[] });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr0 }, body:'a=b' }), 'body').toEqual({ body:'a=b' });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr0 }, body:'a%5Bb%5D=c' }), 'body').toEqual({ body:'a%5Bb%5D=c' });

        const webhdr1 = { 'content-type':'application/json', 'x-protocol-context':'' };
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr1 }, body:'' }), 'body').toEqual({ body:'' });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr1 }, body:null }), 'body').toEqual({ body:null });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr1 }, body:{} as any }), 'body').toEqual({ body:{} });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr1 }, body:'{}' }), 'body').toEqual({ body:{} });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr1 }, body:'[]' }), 'body').toEqual({ body:[] });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr1 }, body:'a=b' }), 'body').toEqual('Unexpected token a in JSON at position 0');
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr1 }, body:'a%5Bb%5D=c' }), 'body').toEqual('Unexpected token a in JSON at position 0');

        const webhdr2 = { 'content-type':'application/x-www-form-urlencoded; charset=utf-8', 'x-protocol-context':'' };
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:'' }), 'body').toEqual({ body:'' });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:null }), 'body').toEqual({ body:null });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:{} as any }), 'body').toEqual({ body:{} });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:'{}' }), 'body').toEqual({ body:{} });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:'[]' }), 'body').toEqual({ body:[] });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:'a=b' }), 'body').toEqual({ body:{ a: 'b' } });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:'a%5B%5D=c' }), 'body').toEqual({ body:{ a:['c'] } });
        expect2(() => service.web.transformToParam({ ...event2, headers: { ...webhdr2 }, body:'a%5Bb%5D=c' }), 'body').toEqual({ body:{ a:{b:'c'} } });

        //! error exceptions
        expect2(() => service.web.transformToParam({ ...event2, headers: null })).toEqual('.headers is required');
        expect2(() => service.web.transformToParam({ ...event2, requestContext: null })).toEqual('.requestContext is required');
        expect2(() => service.web.transformToParam({ ...event2, headers: {} })).toEqual(".headers['x-protocol-context'] is required");
        expect2(() => service.web.transformToParam({ ...event2, requestContext: {...event2.requestContext, accountId:'' } })).toEqual("400 INVALID CONTEXT - accountId:0908");
        expect2(() => service.web.transformToParam({ ...event2, requestContext: {...event2.requestContext, requestId:'' } })).toEqual("400 INVALID CONTEXT - requestId:xxxx");

        /* eslint-enable prettier/prettier */
        done();
    });

    //! for each event protocol
    it('should pass transformEvent() of sns', async done => {
        const { service, config } = instance();
        /* eslint-disable prettier/prettier */
        const id = 'abc';
        const param = asParam('', 'test', { id });
        const uri = service.asProtocolURI('sns', param, config);
        expect2(uri).toEqual('sns://lemon-hello-sns-dev/test/abc');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! for each event protocol
    it('should pass transformEvent() of sqs', async done => {
        const { service, config } = instance();
        /* eslint-disable prettier/prettier */
        const id = 'abc';
        const param = asParam('', 'test', { id });
        const uri = service.asProtocolURI('sqs', param, config);
        expect2(uri).toEqual('sqs://lemon-hello-sqs-dev/test/abc');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! in local environ.
    it('should pass fromURL() w/ local', async done => {
        const { service } = instance();
        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual('protocol-service-test:lemon-hello-api');

        const context: NextContext = {};
        expect2(() => service.fromURL(context, 'http://self/'), 'service,type').toEqual('@url - protocol not supportable (http://)');
        expect2(() => service.fromURL(context, 'lemon://self/'), 'service,type,id,cmd').toEqual({ service:'self', type:'', id:null, cmd:null });
        expect2(() => service.fromURL(context, 'lemon://self/a'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:null, cmd:null });
        expect2(() => service.fromURL(context, 'lemon://self/a/'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'', cmd:null });
        expect2(() => service.fromURL(context, 'lemon://self/a/b'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'b', cmd:null });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'b', cmd:'' });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'b', cmd:'c' });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'b', cmd:'c/' });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/d'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'b', cmd:'c/d' });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/d/'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'b', cmd:'c/d/' });

        expect2(() => service.fromURL(context, 'lemon://u@self/a/b/c/d/'), 'service,type,id,cmd').toEqual({ service:'self', type:'a', id:'b', cmd:'c/d/' });
        expect2(() => service.fromURL(context, 'lemon://self/a/b/c/d/'), 'context').toEqual({ context:{ } });
        expect2(() => service.fromURL(context, 'lemon://u@self/a/b/c/d/'), 'context').toEqual({ context:{ accountId:'u' } });

        expect2(() => service.fromURL(context, 'lemon://self/a/b', {}), 'service,type,mode,body').toEqual({ service:'self', type:'a', mode:'GET' });
        expect2(() => service.fromURL(context, 'lemon://self/a/b', {}, null), 'service,type,mode,body').toEqual({ service:'self', type:'a', mode:'POST', body:null });
        expect2(() => service.fromURL(context, 'lemon://self/a/b', {}, { a:1 }), 'service,type,mode,body').toEqual({ service:'self', type:'a', mode:'POST',body:{ a:1 } });

        /* eslint-enable prettier/prettier */
        done();
    });

    //! for local stage
    it('should pass buildProtocolURI() w/ config (local)', async done => {
        const name = 'lemon-hello-api';
        const version = '1.2.3';
        const stage = 'local';

        const { service2 } = instance({ name, version, stage });
        /* eslint-disable prettier/prettier */
        expect2(service2.hello()).toEqual('protocol-service-test:lemon-hello-api');

        // with account-id
        const context: NextContext = { accountId:'melon' };
        expect2(() => service2.myProtocolURI(context)).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context, '')).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a')).toEqual('api://melon@lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '')).toEqual('api://melon@lemon-hello-api-dev/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '', '')).toEqual('api://melon@lemon-hello-api-dev/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b')).toEqual('api://melon@lemon-hello-api-dev/a/b#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', '')).toEqual('api://melon@lemon-hello-api-dev/a/b#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c')).toEqual('api://melon@lemon-hello-api-dev/a/b/c#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c/d')).toEqual('api://melon@lemon-hello-api-dev/a/b/c/d#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b/c', 'd')).toEqual('api://melon@lemon-hello-api-dev/a/b%2Fc/d#1.2.3');

        // reverse url must be matched.
        expect2(() => service2.fromURL(context, service2.myProtocolURI(context, 'a')),'!mode').toEqual({ service:name, stage:'dev', type:'a', id:null, cmd:null, context });
        expect2(() => service2.fromURL(context, service2.myProtocolURI(context, 'a', 'b', 'c/d')),'!mode').toEqual({ service:name, stage:'dev', type:'a', id:'b', cmd:'c/d', context });
        expect2(() => service2.fromURL(context, service2.myProtocolURI(context, 'a', 'b/c', 'd')),'!mode').toEqual({ service:name, stage:'dev', type:'a', id:'b/c', cmd:'d', context });

        // without account-id
        const context2: NextContext = { accountId:'' };
        expect2(() => service2.myProtocolURI(context2)).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context2, '')).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a')).toEqual('api://lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a', '')).toEqual('api://lemon-hello-api-dev/a/#1.2.3');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! for prod stage
    it('should pass buildProtocolURI() w/ config (local)', async done => {
        const name = 'lemon-hello-api';
        const version = '1.2.3';
        const stage = 'prod';

        const { service2 } = instance({ name, version, stage });
        /* eslint-disable prettier/prettier */
        expect2(service2.hello()).toEqual('protocol-service-test:lemon-hello-api');

        // with account-id
        const context: NextContext = { accountId:'melon' };
        expect2(() => service2.myProtocolURI(context)).toEqual('api://melon@lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context, '')).toEqual('api://melon@lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a')).toEqual('api://melon@lemon-hello-api/a#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '')).toEqual('api://melon@lemon-hello-api/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', '', '')).toEqual('api://melon@lemon-hello-api/a/#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b')).toEqual('api://melon@lemon-hello-api/a/b#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', '')).toEqual('api://melon@lemon-hello-api/a/b#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c')).toEqual('api://melon@lemon-hello-api/a/b/c#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b', 'c/d')).toEqual('api://melon@lemon-hello-api/a/b/c/d#1.2.3');
        expect2(() => service2.myProtocolURI(context, 'a', 'b/c', 'd')).toEqual('api://melon@lemon-hello-api/a/b%2Fc/d#1.2.3');

        // reversed-url should be matched. (and accountId should be recovered)
        const context1: NextContext = { accountId:'' };
        expect2(() => service2.fromURL(context1, service2.myProtocolURI(context, 'a')),'!mode').toEqual({ service:name, stage:'prod', type:'a', id:null, cmd:null, context });
        expect2(() => service2.fromURL(context1, service2.myProtocolURI(context, 'a', 'b', 'c/d')),'!mode').toEqual({ service:name, stage:'prod', type:'a', id:'b', cmd:'c/d', context });
        expect2(() => service2.fromURL(context1, service2.myProtocolURI(context, 'a', 'b/c', 'd')),'!mode').toEqual({ service:name, stage:'prod', type:'a', id:'b/c', cmd:'d', context });

        // without account-id
        const context2: NextContext = { accountId:'' };
        expect2(() => service2.myProtocolURI(context2)).toEqual('api://lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context2, '')).toEqual('api://lemon-hello-api#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a')).toEqual('api://lemon-hello-api/a#1.2.3');
        expect2(() => service2.myProtocolURI(context2, 'a', '')).toEqual('api://lemon-hello-api/a/#1.2.3');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! for local stage
    it('should pass asCallbackURI() w/ config (local)', async done => {
        const name = 'lemon-hello-api';
        const version = '1.2.3';
        const stage = 'local';

        const { service2 } = instance({ name, version, stage });
        /* eslint-disable prettier/prettier */
        expect2(service2.hello()).toEqual('protocol-service-test:lemon-hello-api');

        // with account-id
        const context: NextContext = { accountId:'melon' };
        const cb = (type?: any, id?: any, cmd?: any): CallbackParam => ({ type, id, cmd });
        expect2(() => service2.asCallbackURI(context, cb())).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb(''))).toEqual('api://melon@lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a'))).toEqual('api://melon@lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', ''))).toEqual('api://melon@lemon-hello-api-dev/a/#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', '', ''))).toEqual('api://melon@lemon-hello-api-dev/a/#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', 'b'))).toEqual('api://melon@lemon-hello-api-dev/a/b#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', 'b', ''))).toEqual('api://melon@lemon-hello-api-dev/a/b#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', 'b', 'c'))).toEqual('api://melon@lemon-hello-api-dev/a/b/c#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', 'b', 'c/d'))).toEqual('api://melon@lemon-hello-api-dev/a/b/c/d#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb('a', 'b/c', 'd'))).toEqual('api://melon@lemon-hello-api-dev/a/b%2Fc/d#1.2.3');

        // reverse url must be matched.
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb('a'))),'!mode').toEqual({ service:name, stage:'dev', type:'a', id:null, cmd:null, context });
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb('a', 'b', 'c/d'))),'!mode').toEqual({ service:name, stage:'dev', type:'a', id:'b', cmd:'c/d', context });
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb('a', 'b/c', 'd'))),'!mode').toEqual({ service:name, stage:'dev', type:'a', id:'b/c', cmd:'d', context });

        // without account-id
        const context2: NextContext = { accountId:'' };
        expect2(() => service2.asCallbackURI(context2, cb())).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context2, cb(''))).toEqual('api://lemon-hello-api-dev#1.2.3');
        expect2(() => service2.asCallbackURI(context2, cb('a'))).toEqual('api://lemon-hello-api-dev/a#1.2.3');
        expect2(() => service2.asCallbackURI(context2, cb('a', ''))).toEqual('api://lemon-hello-api-dev/a/#1.2.3');

        //! support with query string from callback.param.
        const param = { x:'', y:1 };
        const cb2 = (t?: any, i?: any, c?: any) => ({ ...cb(t,i,c), param });
        expect2(() => service2.asCallbackURI(context, cb2('a'))).toEqual('api://melon@lemon-hello-api-dev/a?x=&y=1#1.2.3');
        expect2(() => service2.asCallbackURI(context, cb2('a', 'b'))).toEqual('api://melon@lemon-hello-api-dev/a/b?x=&y=1#1.2.3');

        const body = { z:2 };
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb2('a')), null, body)).toEqual({ service:name, stage:'dev', type:'a', id:null, cmd:null, context, mode:'POST', param, body });
        expect2(() => service2.fromURL(context, service2.asCallbackURI(context, cb2('a', 'b')), null, body)).toEqual({ service:name, stage:'dev', type:'a', id:'b', cmd:null, context, mode:'POST', param, body });

        /* eslint-enable prettier/prettier */
        done();
    });
});
