/**
 * `aws-sqs-service.spec.js`
 * - unit test for `aws-sqs-service`
 *
 *
 * //TODO - move to `lemon-core` shared lib.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-27 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { expect2, GETERR, _it } from '../../common/test-helper';
import { AWSSQSService, MyDummySQSService } from './aws-sqs-service';

//! main test body.
describe('AWSSQSService', () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    const ENDPOINTS: { [key: string]: string } = {
        lemon: 'https://sqs.ap-northeast-2.amazonaws.com/085403634746/lemon-test-sqs',
        // lemon: 'https://sqs.ap-northeast-2.amazonaws.com/085403634746/lemon-hello-sqs',
    };

    const wait = async (timeout: number) =>
        new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve(timeout);
            }, timeout);
        });

    //* test basic of service.
    it('should pass basic AWSSQSService()', async () => {
        const ENDPOINT = ENDPOINTS[PROFILE];

        // expect2(() => new AWSSQSService()).toEqual('env.SQS_ENDPOINT is required!');
        // expect2(() => new AWSSQSService()).toEqual('env.MY_SQS_ENDPOINT is required w/ stage:');
        expect2(() => new AWSSQSService(), '_endpoint,_region').toEqual({ _endpoint: '', _region: 'ap-northeast-2' });
        if (ENDPOINT) {
            const service = new AWSSQSService(ENDPOINT);
            expect2(() => service.hello()).toEqual(`aws-sqs-service:${ENDPOINT}`);
            expect2(await service.sendMessage(null, null).catch(GETERR)).toEqual(
                '@data(object) is required - sqs.sendMessage()',
            );

            //* read origin stats
            const timeout = 1; //NOTE - 1 sec.
            const stats = await service.statistics();
            const available = stats.available;

            //TODO - pre-condition checking. clear all messages in queue.

            //* sende message..
            const message = service.hello();
            const attribs = { hello: 'lemon', numb: 2 };
            expect2(() => message).toEqual(`aws-sqs-service:${ENDPOINT}`);

            const queueid = await service.sendMessage(message, attribs);
            console.info(`! queue-id =`, queueid);
            // expect2(queueid).toEqual('9b0888d7-5120-4c36-b29b-ff2cb2bedc39');
            expect2(typeof queueid + ':' + `${queueid}`.length).toEqual(
                'string:' + '9b0888d7-5120-4c36-b29b-ff2cb2bedc39'.length,
            );

            //NOTE - wait more than 1 sec.
            await wait(1200);

            // expect2(await service.statistics(), '!delayed').toEqual({ available: available + 1, inflight: 0, timeout: 30 });
            expect2(await service.statistics(), '!delayed,!inflight').toEqual({
                // available: available + 1,
                available: expect.any(Number),
                timeout,
            });

            //* receive message..
            const result = await service.receiveMessage();
            console.info(`! message-id =`, result?.list?.[0]?.id);

            expect2(() => result.list.length).toEqual(1);
            if (typeof message !== 'string') {
                expect2(() => result.list[0].data).toEqual(message);
            } else {
                expect2(() => result.list[0].data).toEqual({ data: message });
            }
            expect2(() => result.list[0].attr).toEqual(attribs);
            // expect2(() => result.list[0].id).toEqual(queueid); // `queue-id` should be same as `message-id`
            expect2(() => result.list[0].id).toEqual(expect.any(String)); // `queue-id` should be same as `message-id`

            //NOTE - wait sometime.
            await wait(1200);

            // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 1, timeout: 30 });
            expect2(await service.statistics(), '!delayed,!inflight').toEqual({
                // available: available + 1,
                available: expect.any(Number),
                timeout,
            });

            //* delete message
            console.info(`! handle-id =`, result.list[0].handle);
            await service.deleteMessage(result.list[0].handle);

            await wait(1200);

            // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 0, timeout: 30 });
            // expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout });
            expect2(await service.statistics(), '!delayed,!inflight').toEqual({
                // available: available,
                available: expect.any(Number),
                timeout,
            });
        }
    });

    //* test dummy of service.
    it('should pass dummy MyDummySQSService()', async () => {
        const ENDPOINT = ENDPOINTS[PROFILE];

        const service = new MyDummySQSService(ENDPOINT);
        expect2(() => service.hello()).toEqual(`dummy-sqs-service:${ENDPOINT}`);
        expect2(await service.sendMessage(null, null).catch(GETERR)).toEqual('@data(object) is required!');

        //* read origin stats
        const stats = await service.statistics();
        const available = stats.available;

        //* send message
        const message = service.hello();
        const attribs = { hello: 'lemon', numb: 2 };
        const queueid = await service.sendMessage(message, attribs);
        // console.info(`! queue-id =`, queueid);
        // expect2(queueid).toEqual('9b0888d7-5120-4c36-b29b-ff2cb2bedc39');
        expect2(typeof queueid + ':' + `${queueid}`.length).toEqual(
            'string:' + '9b0888d7-5120-4c36-b29b-ff2cb2bedc39'.length,
        );

        //NOTE - wait more than 1 sec.
        await wait(1200);
        // expect2(await service.statistics(), '!delayed').toEqual({ available: available + 1, inflight: 0, timeout: 30 });
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available + 1, timeout: 30 });

        //* receive message..
        const result = await service.receiveMessage();
        // console.info(`! message-id =`, result.list[0].id);
        expect2(() => result.list.length).toEqual(1);
        if (typeof message !== 'string') {
            expect2(() => result.list[0].data).toEqual(message);
        } else {
            expect2(() => result.list[0].data).toEqual({ data: message });
        }
        expect2(() => result.list[0].attr).toEqual(attribs);
        expect2(() => result.list[0].id).toEqual(queueid); // `queue-id` should be same as `message-id`

        //NOTE - wait sometime.
        await wait(1200);
        // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 1, timeout: 30 });
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout: 30 });

        //* delete message
        // console.info(`! handle-id =`, result.list[0].handle);
        await service.deleteMessage(result.list[0].handle);
        await wait(1200);
        // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 0, timeout: 30 });
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout: 30 });
    });
});
