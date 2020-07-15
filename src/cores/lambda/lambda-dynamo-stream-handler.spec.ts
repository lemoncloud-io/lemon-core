/**
 * `lambda-dynamo-stream-handler.spec.ts`
 * - unit test for `lambda-dynamo-stream-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { LambdaDynamoStreamHandler, DynamoStreamFilter, DynamoStreamCallback } from './lambda-dynamo-stream-handler';
import { DynamoOption } from './../dynamo-service';
import * as $lambda from './lambda-handler.spec';
import * as $elastic6 from './../elastic6-service.spec';

class LambdaDynamoStreamHandlerLocal extends LambdaDynamoStreamHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}
export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaDynamoStreamHandlerLocal(lambda);
    return { lambda, service };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaDynamoStreamHandler', () => {
    //! basic handler test
    it('should pass handler listener', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/sample.event.dynamo-stream.json');
        let data: any;
        service.addListener(async (id, param, body, context) => {
            data = { id, param, body, context };
        })
        const res = await service.handle(event, null);
        expect2(res).toEqual(undefined);

        //! check handled data.
        expect2(data, 'id').toEqual({ id:'!' })
        expect2(data, 'param').toEqual({ param:{ eventId:'e6c9208b46a3f10c87cd42555e2a0709', eventName:'MODIFY', region:'ap-northeast-2', tableName:'MetricsTest' } })
        expect2(data.body, 'diff').toEqual({ diff:['count','hello'] })
        expect2(data.body, 'prev').toEqual({ prev:{ count:4, hello:undefined } })
        expect2(data.body, 'keys').toEqual({ keys:{ '@id':'a_123_test', '@ts':1574150700000 } })
        expect2(data.body, 'node').toEqual({ node:{ '@id':'a_123_test', '@ts':1574150700000, count:6, hello:'lemon' } })
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test sync to es6
    it('should pass createSyncToElastic6()', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        const { dummy: elastic6 } = $elastic6.instance();

        const tableName = 'MetricsTest';
        const idName = '@id';
        const id = 'A001';
        const options: DynamoOption = { tableName, idName };

        //! override id value.
        const event: any = loadJsonSync('data/sample.event.dynamo-stream.json');
        event.Records[0].dynamodb.Keys[idName] = { 'S': id };
        event.Records[0].dynamodb.NewImage[idName] = { 'S': id };
        event.Records[0].dynamodb.OldImage[idName] = { 'S': id };

        //! to check handlers were called
        let handlersCalled = { filter: false, onBeforeSync: false, onAfterSync: false };

        ///////////////////////
        //STEP 1. update event.
        //! attach handlers.
        const filter: DynamoStreamFilter = (id, item, diff, prev) => {
            expect2(handlersCalled).toEqual({ filter: false, onBeforeSync: false, onAfterSync: false });
            handlersCalled.filter = true;
            // check diff items
            for (let key of Object.keys(item))
                if (diff.includes(key)) expect2(item[key]).not.toEqual(prev[key]);
            return true;
        };
        const onBeforeSync: DynamoStreamCallback = async (id, eventName, item, diff, prev) => {
            expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: false, onAfterSync: false });
            handlersCalled.onBeforeSync = true;
            // set extra field
            item['X'] = 'x';
        };
        const onAfterSync: DynamoStreamCallback = async (id, eventName, item, diff, prev) => {
            expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: true, onAfterSync: false });
            handlersCalled.onAfterSync = true;
            // check extra field set
            expect2(item['X']).toBe('x');
        };
        const handler = LambdaDynamoStreamHandler.createSyncToElastic6(options, elastic6, filter, onBeforeSync, onAfterSync);
        service.addListener(handler);

        //! pre-condition.
        expect2(await elastic6.readItem(id).catch(GETERR)).toEqual(`404 NOT FOUND - id:${id}`);

        //! trigger event, handler
        const res = await service.handle(event, null);
        expect2(res).toEqual(undefined);

        //! check post-condition.
        expect2(await elastic6.readItem(id).catch(GETERR)).toEqual({ [idName]:`${id}`, '@ts': 1574150700000, count:6, hello:'lemon', id:'A001', X:'x' });

        //! check all handlers were called
        expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: true, onAfterSync: true });

        ///////////////////////
        //STEP 2. delete event.
        event.Records[0].eventName = 'REMOVE';
        handlersCalled = { filter: false, onBeforeSync: false, onAfterSync: false };
        const res2 = await service.handle(event, null);
        expect2(res2).toEqual(undefined);
        expect2(await elastic6.readItem(id).catch(GETERR)).toEqual(`404 NOT FOUND - id:${id}`);     // must be deleted.
        expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: true, onAfterSync: true });

        /* eslint-enable prettier/prettier */
        done();
    });
});
