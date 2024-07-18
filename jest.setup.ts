// jest.setup.js
import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream, TransformStream } from 'node:stream/web';

Object.defineProperties(globalThis, {
    TextDecoder: { value: TextDecoder },
    TextEncoder: { value: TextEncoder },
    ReadableStream: { value: ReadableStream },
    TransformStream: { value: TransformStream },
});

import { Blob, File } from 'node:buffer';
import { fetch, Headers, FormData, Request, Response } from 'undici';

Object.defineProperties(globalThis, {
    fetch: { value: fetch, writable: true },
    Blob: { value: Blob },
    File: { value: File },
    Headers: { value: Headers },
    FormData: { value: FormData },
    Request: { value: Request },
    Response: { value: Response },
});
