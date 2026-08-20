import { createHash } from 'crypto';
import type { WEBEvent, WEBResult } from 'lemon-core/dist/cores/lambda/lambda-handler';

const getHeader = (headers: WEBEvent['headers'], name: string): string =>
    `${Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? ''}`;

const appendVary = (value: unknown): string => {
    const vary = `${value ?? ''}`.trim();
    return vary.split(',').some(name => name.trim().toLowerCase() === 'x-api-key')
        ? vary
        : [vary, 'X-Api-Key'].filter(Boolean).join(', ');
};

export const withBrowserCache = (event: WEBEvent, result: WEBResult): WEBResult => {
    const apiKey = getHeader(event?.headers, 'x-api-key') || event?.requestContext?.identity?.apiKey;
    if (event?.httpMethod !== 'GET' || result?.statusCode !== 200 || !apiKey) return result;

    const etag = `"${createHash('sha256')
        .update(result.body ?? '')
        .digest('base64url')}"`;
    const $headers = {
        ...result.headers,
        'Cache-Control': 'private, no-cache',
        ETag: etag,
        Vary: appendVary(result.headers?.Vary),
    };
    const candidates$$ = getHeader(event.headers, 'if-none-match')
        .split(',')
        .map(value => value.trim());
    const isNotModified = candidates$$.some(value => value === '*' || value === etag || value === `W/${etag}`);
    return isNotModified
        ? { ...result, statusCode: 304, headers: $headers, body: '', isBase64Encoded: false }
        : { ...result, headers: $headers };
};
