/**
 * `types.ts`
 * - main definitions of types
 *
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-09 initial commit
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */

/**
 * RestAPI 요청을 처리하는 콘트롤 함수.
 */
export interface NextHanlder {
    (id?: string, param?: any, body?: any, $ctx?: any): Promise<any>;
}

/**
 * 라우팅 디코더..
 */
export interface NextDecoder {
    (mode?: string, id?: string, cmd?: string): NextHanlder;
}

/**
 * 라우팅 디코더..
 */
export interface NextCallback<T> {
    (error?: Error, data?: T): void;
}

/**
 * Lambda Compartible Handler.
 * ```js
 * const main = (event, context, callback) => {}
 * ```
 */
export interface CoreHandler<T> {
    // basic lambda handler.
    (event: any, context: any, callback: NextCallback<T>): void;
    // helper method without callback.
    do?: (event: any, context: any) => Promise<T>;
}

/**
 * Builder of main() handler.
 */
export interface MainBuilder<T> {
    (NS: string, decode_next_handler: NextDecoder): CoreHandler<T>;
}

/**
 * Builder of event-broker() handler like `SNS` + `SQS`
 * - Transfer to `WebHandler` from origin event source.
 */
export interface BrokerBuilder<T> {
    (defaultType?: string, NS?: string, params?: any): CoreHandler<T>;
}

/**
 * common result of web-handler.
 */
export interface WebResult {
    statusCode: number;
    headers?: {
        [key: string]: string | boolean | number;
    };
    body: string;
}

/**
 * common Web handler.
 */
export interface WebHandler extends CoreHandler<WebResult> {}

/**
 * general message data.
 */
export interface GeneralMessage {
    text?: string;
    pretext?: string;
}

/**
 * Slack Message Format
 *
 * ```js
 * {
 *   "attachments": [
 *       {
 *           "fallback": "Required plain-text summary of the attachment.",
 *           "color": "#2eb886",
 *           "pretext": "Optional text that appears above the attachment block",
 *           "author_name": "Bobby Tables",
 *           "author_link": "http://flickr.com/bobby/",
 *           "author_icon": "http://flickr.com/icons/bobby.jpg",
 *           "title": "Slack API Documentation",
 *           "title_link": "https://api.slack.com/",
 *           "text": "Optional text that appears within the attachment",
 *           "fields": [
 *               {
 *                   "title": "Priority",
 *                   "value": "High",
 *                   "short": false
 *               }
 *           ],
 *           "image_url": "http://my-website.com/path/to/image.jpg",
 *           "thumb_url": "http://example.com/path/to/thumb.png",
 *           "footer": "Slack API",
 *           "footer_icon": "https://platform.slack-edge.com/img/default_application_icon.png",
 *           "mrkdwn": true,
 *           "mrkdwn_in": ['pretext', 'text'],
 *           "ts": 123456789
 *       }
 *   ]
 * }
 * ```
 * see: https://api.slack.com/docs/message-attachments
 */
export interface SlackAttachment extends GeneralMessage {
    fallback?: string;
    color?: 'good' | 'warning' | 'dange' | string;
    author_name?: string;
    author_link?: string;
    author_icon?: string;
    title?: string;
    title_link?: string;
    image_url?: string;
    thumb_url?: string;
    footer?: string;
    footer_icon?: string;
    ts?: number;
    fields?: { title: string; value: string; short?: boolean }[];
    mrkdwn?: boolean;
    mrkdwn_in?: string[];
}

export interface SlackAction {
    type: 'button';
    text: string;
    url?: string;
    style?: 'primary' | 'danger';
}

export interface SlackPostBody {
    text?: string;
    channel?: string;
    attachments: SlackAttachment[];
    actions?: SlackAction[];
}
