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
                    'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:618ce9d2-0000-0000-0000-e248ea51425e:google:10240000000',
                identityPoolId: 'ap-northeast-2:618ce9d2-0000-0000-0000-e248ea51425e',
                identityId: 'ap-northeast-2:c23d7fe4-1111-1111-1111-mocks-user',
                accountId: '0008540000',
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X) Mobile/15E148',
            },
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X) Mobile/15E148',
            clientIp: '222.0.0.192',
            requestId: '95acdfc9-f1216d1d0bdd',
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
                uid: '1000007',
                roles: ['admin'],
                Site: {
                    code: 'B0008',
                },
                User: {
                    name: 'Steve',
                },
                iss: 'kms/lemon-identity-key',
                iat: 1662008470,
                exp: 1662094870,
                identityProvider:
                    'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:57601ace-0000-0000-0000-0b2f96d5959b:google:104662653145614891610',
                identityPoolId: 'ap-northeast-2:57601ace-0000-0000-0000-0b2f96d5959b',
                identityId: 'ap-northeast-2:79a9bb80-0000-0000-0000-86fc750bbdf0',
                accountId: '540000000059',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                caller: 'AROAX3TCR47Z27KAHQLY2:CognitoIdentityCredentials',
            },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            clientIp: '221.0.0.13',
            requestId: 'c80221f0-fe4912850b45',
            accountId: '540000000059',
            domain: 'api.lemoncloud.io',
            source: 'api://540000000059@lemon-hello-api-dev#0.8.22',
        },
        headers: {
            accept: 'application/json',
            Host: 'api.lemoncloud.io',
            origin: 'https://lemoncloud.io',
            pragma: 'no-cache',
            referer: 'https://lemoncloud.io/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ',
            'x-amz-date': '20220901T103712Z',
            'x-amz-security-token':
                'IQoJb3JpZ2luX2VjEOr//////////wEaDmFwLW5vcnRoZWFzdC0yIkcwRQIhALP+JRjNelRmI83/+Fw+qvhW6cLcQNZgLIjjqr8rhqN/AiAedTkTDMybrzvpVl+/eEZ7F+3OaHDZPtvHXBIhn0MnQSqqBAhzEAMaDDU0MDI5ODgzMTg1OSIMTkA0TuM4i4aiLys4KocEXv8A2vNRwDa56CDOU6ldn+XSgXwF/M0eBHjd188CKerUaXW7E95KleuTRyebCPfmtcIrK8JsDu2UdqOr+9exChPzRnNnyjzuA3aos/5xI/YmZE4w8oSFfFV6E97x7YMxlACUZ4x3uWlkLiP/C7DVwCGAmlTIG+jS8sgyibd/1YWeWP9854nk+t4I/xuhDAIeOMT8Mh3CzqzDYpHq9FA0pIkETG6trMfUV/lmqu8W0DpsByJDwkBPOurF/DqYLTSHl9a+dzXLNsgt4ujKl86qpJ5kDUw2MV6Flfwc3FHhl62kF6TGChUsXw4wnm5P9GAbhgBKVeYfb2s8V76EPwmbhdQGNzkm+XSdm3AhInnGyHtN9iRVKugY641p0vE+gCxMYElvwyh1xFh8ToYSAuwsrxJ/CUO6zeJp7UXZ8gMECcZA0V/Eg5qaCttA8G4IARqntm+6K/GKCqvCEDxZp3ipxwONKfmnUmPCpbZrMeue39GFmbMI5zMbkTp1VEuME4tSDgtz5yvSfH6xgRUjQbOPACZQVtxuI5VpS64j9IBRqn/KS6WdO+nWiuhl4jId3tF1thOnHUdrDxUV0yQhODas+0Az+ikDRrFSBDUpo4c0OTIlEYxqGdDG80rFv3s+xdt5eSt2hEC9lMqlzzMjS6YROqojRZBBMnmDJZs6ufUqa8d2Ft2fiaEWMKOIwpgGOoUC/25LcFKBICi6M0/Id/CtouxdXSWJFy80EbX9cHz6irkWzaL4tNjzR1evQ/5Yi5MZDmwxdV0cVT06L4GkovcH3MPC98Kk4O29NX5+OrEL/F9uDneJoygNEbry0X6OqmT8O3RrC0A68+pwd2ot7G6eg+sF+we96FZ8DY8GCVStdeecgCrFgN+rUckoJ3PZv24c5O8w5MXrsO+1s1fnrCwB1YxDSG9ZGWyIUo2JdinA88OWyIgcSgehpH7hMwBNU8L3DLZYYP4QUmHOzW/HB8zsM6ix1Hz6qdqGaZ6n7Rq6IZMqatDVzMacvv4H/GonWSNmp7c0Gq2LSNEjuHvkK0KWFrd1P+Tj',
            'X-Amzn-Trace-Id': 'Root=1-63108b59-316185b70b1958ae5d11b8fd',
            'X-Forwarded-For': '221.0.0.13',
            'X-Forwarded-Port': '443',
            'X-Forwarded-Proto': 'https',
            'x-lemon-identity':
                'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiIxMDAwMDA4IiwiZ2lkIjpudWxsLCJ1aWQiOiIxMDAwMDA3Iiwicm9sZXMiOltdLCJTaXRlIjp7ImNvZGUiOiJCMDAwOCJ9LCJVc2VyIjp7Im5hbWUiOiJTdGV2ZeygleuMgOyasSJ9LCJpc3MiOiJrbXMvbGVtb24taWRlbnRpdHkta2V5IiwiaWF0IjoxNjYyMDA4NDcwLCJleHAiOjE2NjIwOTQ4NzB9.eGlcPuxxLyr8-OmUQtDmJ7ULGx3tgb24t3EraSp3M5Z-TH9vZlYxBMSBRL4IBUEq6QIwOACabjbttgLLN5J26wGhV3VlsmeLR_gOtzYgU4BKzmLS-SOEohBM2z1XsoaxBc4YYkY_zslotkzUbsFQBvNlQkDfSkZ_RUj_kqgbUypPl_U_11PaqCagkrhJvS0JYCx1v3sWgWSip3orHoaQgbhyvkjo8hoB4Gc9n04Eybge9FU0yDJcmLIzUEuN985EOObEkZKm6b6DtOPGwRrXMProeFaVq9nem7k8suYZgAOGNOM6rD-0CGofPtMfCOYaMnTuC48fhgaZQDkP7dGwWg',
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
            clientIp: '110.0.0.53',
            requestId: '833cec64-2f748c76f770',
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
                sid: '1000008',
                gid: null,
                uid: '1000007',
                aid: '#sess-auth',
                roles: ['user'],
                Site: {
                    code: 'B0008',
                },
                User: {
                    name: 'Steve',
                },
                iss: 'kms/lemon-identity-key',
                iat: 1662008470,
                exp: 1662094870,
                identityProvider:
                    'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:57601ace-0000-0000-0000-0b2f96d5959b:google:104662653145614891610',
                identityPoolId: 'ap-northeast-2:57601ace-0000-0000-0000-0b2f96d5959b',
                identityId: 'ap-northeast-2:79a9bb80-0000-0000-0000-86fc750bbdf0',
                accessKey: 'ASIA000000000000FX4Q',
                accountId: '540000000059',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ',
                caller: 'AROAX3TCR47Z27KAHQLY2:CognitoIdentityCredentials',
            },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ',
            clientIp: '221.0.0.13',
            requestId: 'c80221f0-fe4912850b45',
            accountId: '540000000059',
            domain: 'api.lemoncloud.io',
            source: 'api://540000000059@lemon-hello-api-dev#0.8.22',
        },
        headers: {
            accept: 'application/json',
            Host: 'api.lemoncloud.io',
            origin: 'https://lemoncloud.io',
            referer: 'https://lemoncloud.io/',
            'X-Forwarded-For': '221.0.0.13',
            'X-Forwarded-Port': '443',
            'X-Forwarded-Proto': 'https',
            'x-lemon-identity':
                'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiIxMDAwMDA4IiwiZ2lkIjpudWxsLCJ1aWQiOiIxMDAwMDA3Iiwicm9sZXMiOltdLCJTaXRlIjp7ImNvZGUiOiJCMDAwOCJ9LCJVc2VyIjp7Im5hbWUiOiJTdGV2ZeygleuMgOyasSJ9LCJpc3MiOiJrbXMvbGVtb24taWRlbnRpdHkta2V5IiwiaWF0IjoxNjYyMDA4NDcwLCJleHAiOjE2NjIwOTQ4NzB9.eGlcPuxxLyr8-OmUQtDmJ7ULGx3tgb24t3EraSp3M5Z-TH9vZlYxBMSBRL4IBUEq6QIwOACabjbttgLLN5J26wGhV3VlsmeLR_gOtzYgU4BKzmLS-SOEohBM2z1XsoaxBc4YYkY_zslotkzUbsFQBvNlQkDfSkZ_RUj_kqgbUypPl_U_11PaqCagkrhJvS0JYCx1v3sWgWSip3orHoaQgbhyvkjo8hoB4Gc9n04Eybge9FU0yDJcmLIzUEuN985EOObEkZKm6b6DtOPGwRrXMProeFaVq9nem7k8suYZgAOGNOM6rD-0CGofPtMfCOYaMnTuC48fhgaZQDkP7dGwWg',
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
                accountId: '080000000746',
                cognitoIdentityId: null,
                caller: 'AIDAIARRLJP5R642RTOM4',
                sourceIp: '211.0.0.142',
                principalOrgId: 'o-qr6fv8orul',
                accessKey: 'ASIA000000000000FX4Q',
                cognitoAuthenticationType: null,
                cognitoAuthenticationProvider: null,
                userArn: 'arn:aws:iam::080000000746:user/serverless-api',
                userAgent: 'HTTPie/3.2.1',
                user: 'AIDAIARRLJP5R642RTOM4',
            },
        },
        context: {
            identity: {
                identityPoolId: null,
                accountId: '080000000746',
                identityId: null,
                accessKey: 'ASIA000000000000FX4Q',
                authenticationProvider: null,
                userAgent: 'HTTPie/3.2.1',
                caller: 'AIDAIARRLJP5R642RTOM4',
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
                apiKey: 'gW0xFMF5bO9JnMVPCCcst3eCxVrHI5mO2ODW9h94',
            },
            domain: 'xyoisk1ceb.execute-api.ap-northeast-2.amazonaws.com',
            userAgent: 'HTTPie/3.2.1',
            clientIp: '211.208.162.142',
            requestId: '0e1d0d82-a703-41ec-bbe2-22b7c721b4e2',
            accountId: '085403634746',
            source: 'api://085403634746@codes-openapi-api-dev#0.25.1029',
        },
        headers: {
            accept: '*/*',
            Host: 'xyoisk1ceb.execute-api.ap-northeast-2.amazonaws.com',
            'X-Forwarded-For': '211.208.162.142, 3.172.65.212',
            'X-Forwarded-Port': '443',
            'X-Forwarded-Proto': 'https',
            'x-api-key': 'gW0xFMF5bO9JnMVPCCcst3eCxVrHI5mO2ODW9h94',
        },
    },
};

//* main test body.
describe('contexts', () => {
    it('should pass basic', async () => {
        expect2(() => loadSample('authed'), '_').toEqual({ _: '로그인은 했지만, 세션토큰이 없는 경우' });
    });
});
