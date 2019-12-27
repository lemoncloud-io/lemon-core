/**
 * `general-controller.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-16 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import request from 'supertest';
import { LambdaWEBHandler, LambdaHandler } from '../cores/lambda';
import { ProtocolParam, NextHandler } from '../cores';
import { buildEngine } from '../engine';
import { buildExpress, loadJsonSync } from '../tools';
import { expect2, GETERR$ } from '../common/test-helper';
import { GeneralController } from './general-controller';

//! local `lambda-web-handler` to server dummy
class LambdaWEBHandlerLocal extends LambdaWEBHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
    public result: any = null;
    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        const result: TResult = await super.handleProtocol(param);
        this.result = result;
        return result;
    }
}

class GeneralControllerLocal extends GeneralController {
    public constructor(type: string) {
        super(type);
    }
    public async getHelloWorld(id: string) {
        const type = this.type();
        return { hello: `world-${id}`, type };
    }
    public getHelloLemon: NextHandler = async (id: string) => {
        const type = this.type();
        return { hello: `lemon-${id}`, type };
    };
}

//! create instance.
export const instance = (type: string) => {
    const $lambda = new LambdaHandler();
    const $web = new LambdaWEBHandlerLocal($lambda);
    const controller = new GeneralControllerLocal(type);
    const controller2 = new GeneralController(type + '2');
    $web.addController(controller);
    $web.addController(controller2);
    //! build engine + express.app.
    const $engine = buildEngine({});
    const $express = buildExpress($engine, $web);
    return { controller, controller2, app: $express.app };
};

//! main test body.
describe('GeneralController', () => {
    //! general contoller api.
    it('should pass asFuncName()', async done => {
        const { controller } = instance('hello');
        const { controller: controller2 } = instance(null);
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller2.hello()).toEqual('general-controller:');

        expect2(controller.asFuncName('LIST', 'Hello')).toEqual('listHello');
        expect2(controller.asFuncName('GET', null)).toEqual('get');
        expect2(controller.asFuncName('GET', '')).toEqual('get');
        expect2(controller.asFuncName('put', '')).toEqual('put');
        expect2(controller.asFuncName('GET', 'h')).toEqual('getH');
        expect2(controller.asFuncName('put', 'h')).toEqual('putH');
        expect2(controller.asFuncName('GET', 'hello')).toEqual('getHello');
        expect2(controller.asFuncName('put', 'hello')).toEqual('putHello');
        expect2(controller.asFuncName('GET', 'HELLO')).toEqual('getHELLO');

        expect2(controller.asFuncName('', 'hello')).toEqual('doHello');
        expect2(controller.asFuncName(null, 'hello')).toEqual('doHello');
        expect2(controller2.asFuncName('', 'hello')).toEqual('doHello');
        expect2(controller2.asFuncName(null, 'hello')).toEqual('doHello');

        expect2(controller.asFuncName('GET', 'hello', 'world')).toEqual('getHelloWorld');
        expect2(controller.asFuncName('GET', 'hello', 'world-class')).toEqual('getHelloWorldClass');
        expect2(controller.asFuncName('GET', 'hello', '-class')).toEqual('getHelloClass');
        expect2(controller.asFuncName('GET', 'hello', '-')).toEqual('getHello_');
        expect2(controller.asFuncName('GET', 'hello', '-_--')).toEqual('getHello____');
        expect2(controller.asFuncName('GET', 'hello', '-Me')).toEqual('getHelloMe');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! general contoller api.
    it('should pass basic CRUD w/ general-controller', async done => {
        const { controller, app } = instance('hello');
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-controller:hello');

        //! check basic express.app
        const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status,text').toEqual({ status: 200, text:`${$pack.name}/${$pack.version}` });

        //! each function mapping.
        expect2(await request(app).get('/hello/aa/world'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'world-aa' } });     // via `getHelloWorld()`
        expect2(await request(app).get('/hello/bb/lemon'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'lemon-bb' } });     // via `getHelloLemon()`

        expect2(await request(app).get('/hello/aa').catch(GETERR$), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello/aa' });
        expect2(await request(app).get('/hello/aa/some').catch(GETERR$), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello/aa/some' });

        /* eslint-enable prettier/prettier */
        done();
    });
});
