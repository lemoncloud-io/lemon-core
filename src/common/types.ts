/**
 * `types.ts`
 * - main definitions of types
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-09 initial commit
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */

/**
 * class: `CallbackData`
 * - data types for `/callback` notification.
 * - payload data-set to report callback.
 */
export interface CallbackData {
    id?: string; // id value
    cmd?: string; // command name
    param?: any; // parameters
    body?: any; // main data body
    result?: any; // result-set
    error?: any; // error if exception.
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
export interface SlackAttachment {
    fallback?: string;
    color?: 'good' | 'warning' | 'danger' | string;
    pretext?: string;
    author_name?: string;
    author_link?: string;
    author_icon?: string;
    title?: string;
    title_link?: string;
    text?: string;
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

/**
 * class: `MetricPostBody`
 * - metrics for recording graph.
 */
export interface MetricPostBody {
    meta?: string;
    [key: string]: string | number | number[];
}
