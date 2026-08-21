/**
 * `contexts.spec.ts`
 * - sample context in ts
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2024-11-29 initial samples.
 *
 * @copyright   (C) 2024 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, it, expect2, expect } from './commons.spec';
import { NextContext } from 'lemon-model';

/**
 * sample sample context
 *
 * @param type type of
 * @returns context
 * @see `./contexts.spec.ts/$context[<type>]`
 */
export const loadSample = (type: string) => {
    const $ctx = $context[type];
    if (!$ctx) throw new Error(`@type[${type}] is invalid - @service.instance()`);
    // const { context, data } = loadJsonSync(`sample/context/context-${type}.json`);
    return JSON.parse(JSON.stringify($ctx));
};

/**
 * sample of request
 */
const $context: {
    [key: string]: {
        /** explanation */
        _?: string;
        /** sample to execute */
        $?: string;
        /** origin request-context in lambda */
        requestContext?: any;
        /** the packed package */
        context: NextContext<{ [key: string]: any }>;
        /** http request headers */
        headers?: { [key: string]: string };
        /** optional data */
        data?: any;
    };
} = {
    /**
     * http signed with cognito identity, but without `identity-token`.
     */
    authed: {
        _: '로그인은 했지만, 세션토큰이 없는 경우',
        context: {
            identity: {
                identityProvider:
                    'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:00000000-0000-0000-0000-000000000000:google:00000000000',
                identityPoolId: 'ap-northeast-2:00000000-0000-0000-0000-000000000000',
                identityId: 'ap-northeast-2:00000000-1111-1111-1111-mocks-user',
                accountId: '0008540000',
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X) Mobile/15E148',
            },
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X) Mobile/15E148',
            clientIp: '203.0.113.1',
            requestId: 'a0000001-000000000001',
            accountId: '0008540000',
            domain: 'oauth.lemoncloud.io',
            source: 'api://0008540000@lemon-hello-api#2.12.24a',
        },
    },
    /**
     * 특정 사이트에 엮이지 않은 세션 토큰 (sid=#)
     */
    offsite: {
        _: '특정 사이트에 엮이지 않은 세션 토큰 - 전국구',
        context: {
            identity: {
                sid: '#',
                gid: null,
                uid: '1000001',
                roles: ['admin'],
                Site: {
                    code: 'B0008',
                },
                User: {
                    name: 'mocks-user',
                },
                iss: 'kms/lemon-identity-key',
                iat: 1662008470,
                exp: 1662094870,
                identityProvider:
                    'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:00000000-0000-0000-0000-000000000000:google:000000000000000000000',
                identityPoolId: 'ap-northeast-2:00000000-0000-0000-0000-000000000000',
                identityId: 'ap-northeast-2:00000000-0000-0000-0000-000000000000',
                accountId: '111122223333',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                caller: 'AROADBQP57FF2AEXAMPLE:CognitoIdentityCredentials',
            },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            clientIp: '203.0.113.2',
            requestId: 'a0000002-000000000002',
            accountId: '111122223333',
            domain: 'api.lemoncloud.io',
            source: 'api://111122223333@lemon-hello-api-dev#0.8.22',
        },
        headers: {
            accept: 'application/json',
            Host: 'api.lemoncloud.io',
            origin: 'https://lemoncloud.io',
            pragma: 'no-cache',
            referer: 'https://lemoncloud.io/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ',
            'x-amz-date': '20220901T103712Z',
            'x-amz-security-token': 'IQoJDummySecurityToken000000000000000000000000000000000000',
            'X-Amzn-Trace-Id': 'Root=1-00000000-000000000000000000000001',
            'X-Forwarded-For': '203.0.113.2',
            'X-Forwarded-Port': '443',
            'X-Forwarded-Proto': 'https',
            'x-lemon-identity':
                'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiIxMDAwMDAwIiwiZ2lkIjpudWxsLCJ1aWQiOiIxMDAwMDAxIiwicm9sZXMiOltdLCJTaXRlIjp7ImNvZGUiOiJCMDAwOCJ9LCJVc2VyIjp7Im5hbWUiOiJtb2Nrcy11c2VyIn0sImlzcyI6Imttcy9sZW1vbi1pZGVudGl0eS1rZXkiLCJpYXQiOjE2NjIwMDg0NzAsImV4cCI6MTY2MjA5NDg3MH0.masked-signature',
        },
    },
    /**
     * http request with public api
     */
    public: {
        context: {
            identity: {
                identityProvider: null,
                identityPoolId: null,
                identityId: null,
                accountId: null,
                userAgent: 'okhttp/3.12.5',
            },
            userAgent: 'okhttp/3.12.5',
            clientIp: '203.0.113.3',
            requestId: 'a0000003-000000000003',
            accountId: '0008540000',
            domain: 'oauth.lemoncloud.io',
            source: 'api://0008540000@lemon-hello-api#2.12.24a',
        },
        headers: {
            accept: 'application/json',
        },
        data: {
            Account: null,
            Access: null,
        },
    },
    /**
     * request with cognito signature along with identity-token
     */
    session: {
        context: {
            identity: {
                sid: '1000000',
                gid: null,
                uid: '1000001',
                aid: '#sess-0000',
                roles: ['user'],
                Site: {
                    code: 'B0008',
                },
                User: {
                    name: 'mocks-user',
                },
                iss: 'kms/lemon-identity-key',
                iat: 1662008470,
                exp: 1662094870,
                identityProvider:
                    'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:00000000-0000-0000-0000-000000000000:google:000000000000000000000',
                identityPoolId: 'ap-northeast-2:00000000-0000-0000-0000-000000000000',
                identityId: 'ap-northeast-2:00000000-0000-0000-0000-000000000000',
                accessKey: 'ASIA000000000000FX4Q',
                accountId: '111122223333',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ',
                caller: 'AROADBQP57FF2AEXAMPLE:CognitoIdentityCredentials',
            },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ',
            clientIp: '203.0.113.2',
            requestId: 'a0000002-000000000002',
            accountId: '111122223333',
            domain: 'api.lemoncloud.io',
            source: 'api://111122223333@lemon-hello-api-dev#0.8.22',
        },
        headers: {
            accept: 'application/json',
            Host: 'api.lemoncloud.io',
            origin: 'https://lemoncloud.io',
            referer: 'https://lemoncloud.io/',
            'X-Forwarded-For': '203.0.113.2',
            'X-Forwarded-Port': '443',
            'X-Forwarded-Proto': 'https',
            'x-lemon-identity':
                'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiIxMDAwMDAwIiwiZ2lkIjpudWxsLCJ1aWQiOiIxMDAwMDAxIiwicm9sZXMiOltdLCJTaXRlIjp7ImNvZGUiOiJCMDAwOCJ9LCJVc2VyIjp7Im5hbWUiOiJtb2Nrcy11c2VyIn0sImlzcyI6Imttcy9sZW1vbi1pZGVudGl0eS1rZXkiLCJpYXQiOjE2NjIwMDg0NzAsImV4cCI6MTY2MjA5NDg3MH0.masked-signature',
        },
    },
    /**
     * http request w/ sign-v4 with access-key + secret.
     */
    signed: {
        _: 'access-key 만을 이용해서 데이터를 요청한 경우!',
        $: 'http --auth-type aws4 --auth profile=lemon ...',
        requestContext: {
            identity: {
                cognitoIdentityPoolId: null,
                accountId: '444455556666',
                cognitoIdentityId: null,
                caller: 'AIDACKCEVSQ6C2EXAMPLE',
                sourceIp: '203.0.113.4',
                principalOrgId: 'o-exampleorgid',
                accessKey: 'ASIA000000000000FX4Q',
                cognitoAuthenticationType: null,
                cognitoAuthenticationProvider: null,
                userArn: 'arn:aws:iam::444455556666:user/serverless-api',
                userAgent: 'HTTPie/3.2.1',
                user: 'AIDACKCEVSQ6C2EXAMPLE',
            },
        },
        context: {
            identity: {
                identityPoolId: null,
                accountId: '444455556666',
                identityId: null,
                accessKey: 'ASIA000000000000FX4Q',
                authenticationProvider: null,
                userAgent: 'HTTPie/3.2.1',
                caller: 'AIDACKCEVSQ6C2EXAMPLE',
            },
        },
    },
    /**
     * http request w/ api-key (API Gateway)
     */
    apiKey: {
        context: {
            identity: {
                identityProvider: null,
                identityPoolId: null,
                identityId: null,
                accountId: null,
                userAgent: 'HTTPie/3.2.1',
                apiKey: 'DummyApiKey00000000000000000000000000000',
            },
            domain: 'dummyapi0x.execute-api.ap-northeast-2.amazonaws.com',
            userAgent: 'HTTPie/3.2.1',
            clientIp: '203.0.113.5',
            requestId: 'a0000005-0000-4000-8000-000000000005',
            accountId: '777788889999',
            source: 'api://777788889999@dummy-openapi-api-dev#0.25.1029',
        },
        headers: {
            accept: '*/*',
            Host: 'dummyapi0x.execute-api.ap-northeast-2.amazonaws.com',
            'X-Forwarded-For': '203.0.113.5, 198.51.100.6',
            'X-Forwarded-Port': '443',
            'X-Forwarded-Proto': 'https',
            'x-api-key': 'DummyApiKey00000000000000000000000000000',
        },
    },
};

//* main test body.
describe('contexts', () => {
    it('should pass basic', async () => {
        expect2(() => loadSample('authed'), '_').toEqual({ _: '로그인은 했지만, 세션토큰이 없는 경우' });
    });
});
