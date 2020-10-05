/**
 * `lambda-notification-handler.spec.ts`
 * - unit test for `lambda-notification-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-17 initial version.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { LambdaNotificationHandler } from './lambda-notification-handler';
import * as $lambda from './lambda-handler.spec';

class LambdaNotificationHandlerLocal extends LambdaNotificationHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}
export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaNotificationHandlerLocal(lambda);
    return { lambda, service };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaNotificationHandler', () => {
    //! expected headers in common.
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Headers': 'origin, x-lemon-language',
    };

    //! handle for subscription
    it('should pass sns subscription', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/sample.event.noti-sub.json');
        //! validate event
        expect2(event.resource).toEqual('/{proxy+}')
        expect2(event.path).toEqual('/hello/noti')

        //! after handler.
        let data: any;
        service.addListener(async (id, param, body, context) => {
            data = { id, param, body, context };
            return 'NOP';
        })
        const res = await lambda.handle(event, null);
        const snsSubscriptionArn = undefined as any;
        const snsTopicArn ='arn:aws:sns:ap-northeast-2:796730245826:lemon-todaq-out';
        const subscribeURL = 'https://sns.ap-northeast-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:ap-northeast-2:796730245826:lemon-todaq-out&Token=.....';
        const signature = 'E/CqqnBfEbglCBM4W0uGTN4IrPM/40MqyOrVUHvsZPI5EDpfDj8L/UTUiu+y3pUoY/b//EJB0lXsy+VcjUBPa66n93/c4YqhrTJxq2zlWHe0rEUQ9GJVqDXQATNflO1zKTRQonRee0kVksB2PP+1vy43gRWs/1QD5QvfrqpUz7mFlB0jyQ4bCm4b6b5iIkBeh0P0A2InuE0BOl9dcS2qNWCeThAU88aNSWaPeTcY0LnQm1szUYNouphUhxf5ogKL9Qv0hhfOC4mGpqw6IJ9PTxY6Ff3UlFeNla/Z73AOTVzhrmcs7ih2ycIYJqedUGqILQL5IdDsHcJpzl41aWno7Q==';
        expect2(res).toEqual({"body": "NOP", headers, statusCode: 200, isBase64Encoded:false });
        expect2(data, 'id').toEqual({ id: event.path });
        //! param should have `subscribeURL` for `SubscriptionConfirmation`
        expect2(data, 'param').toEqual({ param:{ snsMessageId:'ef9765be-a053-40d8-907b-4a212b8a8b6e', snsMessageType:'SubscriptionConfirmation', snsTopicArn, snsSubscriptionArn, subscribeURL, signature }});
        expect2(data, 'context').toEqual({ context:{ accountId:'796730245826', clientIp:'54.239.110.00', domain:'9tdk25wjpd.execute-api.ap-northeast-2.amazonaws.com', requestId:'3e55dcae-523a-48ae-861b-b776208c4b70' }});
        expect2(typeof data.body).toEqual('object');
        expect2(data.body, 'text').toEqual({ text:'subscribe to the topic' });

        /* eslint-enable prettier/prettier */
        done();
    });

    //! handle for notification
    it('should pass notification w/ raw-delivery ', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/sample.event.noti-msg-raw.json');
        //! validate event
        expect2(event.resource).toEqual('/{proxy+}')
        expect2(event.path).toEqual('/hello/noti')

        //! after handler.
        let data: any;
        service.addListener(async (id, param, body, context) => {
            data = { id, param, body, context };
            return 'NOP';
        })
        const res = await lambda.handle(event, null);
        expect2(res).toEqual({"body": "NOP", headers, statusCode: 200, isBase64Encoded:false });
        expect2(data, 'id').toEqual({ id: event.path });
        expect2(data, 'param').toEqual({ param:{ snsMessageId:'ce739c18-f6bf-5d16-8818-ca6a56522dfa', snsMessageType:'Notification', snsTopicArn:'arn:aws:sns:ap-northeast-2:796730245826:lemon-todaq-out', snsSubscriptionArn:'arn:aws:sns:ap-northeast-2:796730245826:lemon-todaq-out:691a3ee3-5e1b-4b44-b0c0-ad1cd6a5b87f' }});
        expect2(data, 'context').toEqual({ context:{ accountId:'796730245826', clientIp:'54.239.110.00', domain:'9tdk25wjpd.execute-api.ap-northeast-2.amazonaws.com', requestId:'3e7f3eff-f666-4e4f-9d47-590418938684' }});
        expect2(typeof data.body).toEqual('object');
        expect2(data.body, '').toEqual({ hello:'world' });

        /* eslint-enable prettier/prettier */
        done();
    });

    //! handle for notification
    it('should pass notification w/ no-raw ', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/sample.event.noti-msg-noraw.json');
        //! validate event
        expect2(event.resource).toEqual('/{proxy+}')
        expect2(event.path).toEqual('/hello/noti')

        //! after handler.
        let data: any;
        service.addListener(async (id, param, body, context) => {
            data = { id, param, body, context };
            return 'NOP';
        })
        const res = await lambda.handle(event, null);
        const snsSubscriptionArn = 'arn:aws:sns:ap-northeast-2:796730245826:lemon-todaq-out:407826b6-3138-457c-a48b-ddc9f5aba2e8';
        const snsTopicArn = 'arn:aws:sns:ap-northeast-2:796730245826:lemon-todaq-out';
        const subject = 'Hello Noti';
        const myParam = { a:'b', b:1 };
        expect2(res).toEqual({"body": "NOP", headers, statusCode: 200, isBase64Encoded: false});
        expect2(data, 'id').toEqual({ id: event.path });
        //! myParam should be merged to handler's param.
        expect2(data, 'param').toEqual({ param:{ snsMessageId:'ce739c18-f6bf-5d16-8818-ca6a56522dfa', snsMessageType:'Notification', snsTopicArn, snsSubscriptionArn, subject, ...myParam }});
        expect2(data, 'context').toEqual({ context:{ accountId:'796730245826', clientIp:'54.239.110.00', domain:'9tdk25wjpd.execute-api.ap-northeast-2.amazonaws.com', requestId:'a11b1ddd-4987-46f4-9fdd-c5ddc88e9705' }});
        expect2(typeof data.body).toEqual('object');
        expect2(data.body, '').toEqual({ hello:'world' });

        /* eslint-enable prettier/prettier */
        done();
    });
});
