/**
 * `aws-sqs-service.spec.js`
 * - unit test for `aws-sqs-service`
 *
 *
 * //TODO - move to `lemon-core` shared lib.
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-25 initial azure service bus queues service
 *
 * @copyright (C) 2023 LemonCloud Co Ltd. - All Rights Reserved.
 */

import { QueuesService, MyDummySQSService } from './azure-sb-queues-service';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GETERR, GETERR$, expect2, marshal, Filter, _it, environ } from '../../common/test-helper';

//! main test body.
jest.setTimeout(13000);
describe('QueuesService', () => {
    //! use `env.PROFILE`

    const wait = async (timeout: number) =>
        new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve(timeout);
            }, timeout);
        });

    //! test basic of service.
    it('should pass basic QueuesService()', async done => {
        // expect2(() => new QueuesService()).toEqual('env.SQS_ENDPOINT is required!');
        // expect2(() => new QueuesService()).toEqual('env.MY_SQS_ENDPOINT is required w/ stage:');

        /* eslint-disable prettier/prettier */
        const service = new QueuesService();
        expect2(() => service.hello()).toEqual(`az-sb-queues-service:queue-lemon`);

        //! sende message..
        const message: any = service.hello();
        // const attribs = { hello: 'lemon', numb: 2 };
        const stats = await service.statistics()
        const available = stats.available;

        // string send test
        await service.sendMessage(message);
        const result = await service.receiveMessage();
        console.info(`! message-id =`, result.list[0].messageId);
        expect2(result.list.length).toEqual(1);
        expect2(result.list[0].body).toEqual(message);
        await service.deleteMessage(result.list[0]);
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout: 60 });
        // object send test
        const message2 = {
            azure: "hello"
        }
        await service.sendMessage(message2);
        const result2 = await service.receiveMessage()
        expect2(result2.list.length).toEqual(1);
        expect2(result2.list[0].body).toEqual(message2);

        await service.deleteMessage(result2.list[0]);
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout: 60 });

        // array send test
        const message3 = ["azure", "hello"]
        await service.sendMessage(message3);
        const result3 = await service.receiveMessage();
        expect2(result3.list.length).toEqual(1);
        expect2(result3.list[0].body).toEqual(message3);

        await service.deleteMessage(result3.list[0]);
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout: 60 });

        done();
    });
});
