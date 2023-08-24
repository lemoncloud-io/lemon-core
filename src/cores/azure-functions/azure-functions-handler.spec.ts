/**
 * API: `/hello`
 * - public service api
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-08-23 initial version
 *
 * @copyright (C) 2023 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { AzureFunctionsHandler } from './azure-functions-handler';
import { expect2, GETERR$ } from '../../common/test-helper';
import { Context, HttpRequest, HttpResponse, Form } from '@azure/functions';

class AzureFunctionsHandlerLocal extends AzureFunctionsHandler {
    public constructor() {
        super();
    }
}

export const instance = () => {
    const service = new AzureFunctionsHandlerLocal();
    return { service };
};

describe('AzureFunctionsHandler', () => {
    // Test for handling 'hello' event
    it('should respond with "world" for "hello" event', async () => {
        const { service } = instance();
        service.setHandler('web', async (_: Context, req: HttpRequest): Promise<HttpResponse> => {
            // You can access request body and headers using `req.body` and `req.headers`
            return {
                status: 200,
                body: 'world'
            };
        });
        
        const context: Context = {} as Context;
        const req: HttpRequest = {
            method: 'GET',
            url: 'https://sls-korc-dev-azure-hello-api.azurewebsites.net', // Deployed Azure Functions URL
            headers: {type:"httpTrigger"},
            query: {},
            params: {},
            user: {
                type: 'AppService',
                id: 'user-id',
                username: 'username',
                identityProvider: 'provider',
                claimsPrincipalData: {}
            },
            get: (field: string) => {
                // Implement logic to retrieve data from query parameters based on the field
                // Example: return req.query[field];
                return ''; // Return a default value for now
            },
            parseFormBody: () => ({} as Form) // Specify the expected return type here
        };
        
        
        // Call the handler
        const response = await service.handle(context, req).catch(GETERR$);
        expect2(response.status).toEqual(200); // Expecting HTTP status code 200
        expect2(response.body).toEqual('world'); // Expecting 'world' response
    });
});
