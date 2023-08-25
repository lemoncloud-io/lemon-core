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
import { expect2, GETERR$ } from '../../common/test-helper';
import { Context, HttpRequest, HttpResponse, Form } from '@azure/functions';
import HellohttpTrigger from './azure-functions-trigger';


describe('AzureFunctionsTrigger', () => {
    // Test for handling 'hello' event
    it('test', async () => {
        const context: Context = {} as Context;
        const req: HttpRequest = {
            method: 'GET',
            url: '',
            headers: {},
            query: { name: 'ian' },
            params: {},
            body: {}, // Set the body object
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

        // Call the httpTrigger
        await HellohttpTrigger(context, req)

        if (context.res) {
            expect2(context.res.status).toEqual(200);
            expect2(context.res.body).toContain('Hello, ian. This HTTP triggered function executed successfully.');
        } else {
            throw new Error('context.res is undefined');
        }

    });
});