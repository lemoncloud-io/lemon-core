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
import { MyProtocolService } from './protocol-service';
import { MyConfigService } from './../config/config-service';
import { NextContext } from './../core-types';
import { ProtocolParam } from './../core-services';
import { APIGatewayProxyEvent } from 'aws-lambda';

const DEF_SERVICE = 'lemon-hello-api';
const DEF_TYPE = 'lemon';

class MyProtocolServiceTest extends MyProtocolService {
    public constructor(service: string = DEF_SERVICE, type: string = DEF_TYPE) {
        super(service, type);
    }
    public hello = () => `protocol-service-test:${this.selfService}/${this.selfType}`;
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
export const instance = (env?: { [key: string]: string }) => {
    env = { STAGE: 'local', NAME: 'test', ...env };
    const service = new MyProtocolServiceTest();
    const config = new MyConfigServiceTest(env);
    return { service, config };
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
        expect2(service.hello()).toEqual('protocol-service-test:lemon-hello-api/lemon');
        expect2(config.hello()).toEqual('config-service-test:local');
        /* eslint-enable prettier/prettier */
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

        //! check path.
        expect2(service.asProtocolURI('sqs', asParam('', 'test'), config)).toEqual('sqs://lemon-hello-sqs-dev/test');
        expect2(service.asProtocolURI('sqs', asParam('', 'test/0'), config)).toEqual('sqs://lemon-hello-sqs-dev/test%2F0');
        expect2(service.asProtocolURI('sqs', asParam('', 'test 0'), config)).toEqual('sqs://lemon-hello-sqs-dev/test%200');

        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'1' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/1');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'', cmd:'' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'1', cmd:'2' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/1/2');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'', cmd:'2' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test//2');
        expect2(service.asProtocolURI('sqs', asParam('', 'test', { id:'1', cmd:'2/3' }), config)).toEqual('sqs://lemon-hello-sqs-dev/test/1/2%2F3');

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
});
