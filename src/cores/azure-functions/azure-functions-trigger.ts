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
import { AzureFunction, Context, HttpRequest } from '@azure/functions';

const HellohttpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
    if (req.query.name || (req.body && req.body.name)) {
        const name = req.query.name || req.body.name;
        context.res = {
            // status: 200, /* Defaults to 200 */
            status: 200,
            body: `Hello, ${name}. This HTTP triggered function executed successfully.`,
        };
    } else {
        context.res = {
            status: 400,
            body: 'Please pass a name on the query string or in the request body.',
        };
    }
};

export default HellohttpTrigger;
