/**
 * `aws-s3-service.b18.spec.ts`
 * - v5 B18: offline unit test of `AWSS3Service` (the SDK client `send()` is stubbed; no AWS call).
 * - checks the command type and input the service builds, and how the responses and errors map.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'stream';
import {
    S3Client,
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    GetObjectTaggingCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { AWSS3Service } from './aws-s3-service';
import { GETERR } from '../../common/test-helper';

//* v5 B18: dummy bucket name (not a real resource).
const BUCKET = 'test-bucket';

describe('AWSS3Service (B18 offline)', () => {
    let send: ReturnType<typeof vi.fn>;
    // stub the client boundary for each case (the client is created offline, `send()` never reaches AWS).
    beforeEach(() => {
        vi.stubEnv('MY_S3_BUCKET', BUCKET);
        vi.stubEnv('REGION', 'ap-northeast-2');
        send = vi.fn();
        vi.spyOn(S3Client.prototype, 'send').mockImplementation(((cmd: any) => send(cmd)) as any);
    });
    // restore the spy and env after each case.
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });
    // the command passed to `send()` at call `n`.
    const cmdOf = (n = 0) => send.mock.calls[n][0];

    it('B18 bucket() and hello() use env MY_S3_BUCKET', () => {
        const s3 = new AWSS3Service();
        expect(s3.bucket()).toBe(BUCKET);
        expect(s3.hello()).toBe(`aws-s3-service:${BUCKET}`);
        expect(s3.bucket('other-bucket')).toBe('other-bucket');
    });

    it('B18 headObject() maps the result, and 404 to null', async () => {
        const s3 = new AWSS3Service();
        expect(await s3.headObject('').catch(GETERR)).toBe('@key (string) is required - headObject()');

        send.mockResolvedValueOnce({
            ContentType: 'application/json',
            ContentLength: 12,
            Metadata: { md5: 'abc' },
            ETag: '"e1"',
            LastModified: new Date(Date.UTC(2026, 9, 30, 0, 0, 0)),
        });
        const res = await s3.headObject('a/b.json');
        expect(cmdOf()).toBeInstanceOf(HeadObjectCommand);
        expect(cmdOf().input).toEqual({ Bucket: BUCKET, Key: 'a/b.json' });
        expect(res).toMatchObject({ ContentType: 'application/json', ContentLength: 12, ETag: '"e1"' });
        expect(res.Metadata).toEqual({ md5: 'abc' });
        expect(typeof res.LastModified).toBe('string');

        //* not found by status, or by name.
        send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
        expect(await s3.headObject('none')).toBeNull();
        send.mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFound' }));
        expect(await s3.headObject('none')).toBeNull();

        //* other errors are thrown.
        send.mockRejectedValueOnce(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));
        expect(await s3.headObject('x').catch(GETERR)).toBe('Access Denied');
    });

    it('B18 putObject() builds Key/ContentType/Metadata/Tagging', async () => {
        const s3 = new AWSS3Service();
        expect(await s3.putObject('').catch(GETERR)).toBe('@content (buffer) is required - putObject()');

        //* key + tags: content-type from the key extension.
        send.mockResolvedValueOnce({ ETag: '"e2"', key: 'dropped' });
        const res = await s3.putObject('{"a":1}', 'dir/a.json', undefined, { team: 'lemon', env: 'test' });
        const input = cmdOf().input;
        expect(cmdOf()).toBeInstanceOf(PutObjectCommand);
        expect(input.Bucket).toBe(BUCKET);
        expect(input.Key).toBe('dir/a.json');
        expect(input.ContentType).toBe('application/json; charset=utf-8');
        expect(input.ContentLength).toBe(7);
        expect(input.Tagging).toBe('team=lemon&env=test');
        expect(Object.keys(input.Metadata)).toEqual(['md5']);
        expect(Buffer.isBuffer(input.Body)).toBe(true);
        expect(res).toEqual({
            Bucket: BUCKET,
            Location: `https://${BUCKET}.s3.ap-northeast-2.amazonaws.com/dir/a.json`,
            Key: 'dir/a.json',
            ETag: '"e2"',
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 7,
            Metadata: input.Metadata,
        });

        //* explicit `Content-Type` metadata wins over the key, and leaves the metadata.
        send.mockResolvedValueOnce({ ETag: '"e3"' });
        await s3.putObject(Buffer.from('hello'), undefined, { 'Content-Type': 'text/plain', owner: 'me' });
        const in2 = cmdOf(1).input;
        expect(in2.ContentType).toBe('text/plain');
        expect(in2.Key).toMatch(/^[0-9a-f-]{36}\.txt$/);
        expect(in2.Metadata).toEqual({ md5: in2.Metadata.md5, owner: 'me' });
        expect(in2.Tagging).toBeUndefined();

        //* `origin` metadata gives the content-type.
        send.mockResolvedValueOnce({ ETag: '"e4"' });
        await s3.putObject('<p/>', undefined, { origin: 'page.html' });
        expect(cmdOf(2).input.ContentType).toBe('text/html; charset=utf-8');
        expect(cmdOf(2).input.Key).toMatch(/\.html$/);

        //* no key, no metadata: uuid + `.json`.
        send.mockResolvedValueOnce({ ETag: '"e5"' });
        const res4 = await s3.putObject('x');
        expect(res4.Key).toMatch(/^[0-9a-f-]{36}\.json$/);
        expect(res4.ContentType).toBe('application/json; charset=utf-8');

        //* error is thrown as is.
        send.mockRejectedValueOnce(new Error('AccessDenied'));
        expect(await s3.putObject('x', 'k.json').catch(GETERR)).toBe('AccessDenied');
    });

    it('B18 getObject() reads the stream body into a buffer', async () => {
        const s3 = new AWSS3Service();
        expect(await s3.getObject('').catch(GETERR)).toBe('@key (string) is required - getObject()');

        send.mockResolvedValueOnce({
            ContentType: 'text/plain',
            ContentLength: 11,
            Body: Readable.from([Buffer.from('hello '), 'lemon']),
            ETag: '"e6"',
            Metadata: { a: '1' },
            TagCount: 2,
        });
        const res = await s3.getObject('k.txt');
        expect(cmdOf()).toBeInstanceOf(GetObjectCommand);
        expect(cmdOf().input).toEqual({ Bucket: BUCKET, Key: 'k.txt' });
        expect(res.Body.toString()).toBe('hello lemon');
        expect(res).toMatchObject({ ContentType: 'text/plain', ContentLength: 11, ETag: '"e6"', TagCount: 2 });

        //* no stream body, no tag-count.
        send.mockResolvedValueOnce({ ETag: '"e7"' });
        const res2 = await s3.getObject('k2');
        expect(res2.Body).toBeUndefined();
        expect('TagCount' in res2).toBe(false);

        send.mockRejectedValueOnce(new Error('NoSuchKey'));
        expect(await s3.getObject('none').catch(GETERR)).toBe('NoSuchKey');
    });

    it('B18 getDecodedObject() parses the JSON body', async () => {
        const s3 = new AWSS3Service();
        expect(await s3.getDecodedObject('').catch(GETERR)).toBe('@key (string) is required - getDecodedObject()');

        send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('{"hello":"lemon"}')]) });
        expect(await s3.getDecodedObject('a.json')).toEqual({ hello: 'lemon' });
        expect(cmdOf()).toBeInstanceOf(GetObjectCommand);

        //* empty body: JSON.parse(undefined) fails, and the error is thrown.
        send.mockResolvedValueOnce({});
        expect(await s3.getDecodedObject('empty.json').catch(e => e instanceof SyntaxError)).toBe(true);
    });

    it('B18 getObjectTagging() maps TagSet to a dictionary', async () => {
        const s3 = new AWSS3Service();
        expect(await s3.getObjectTagging('').catch(GETERR)).toBe('@key (string) is required - getObjectTagging()');

        send.mockResolvedValueOnce({
            TagSet: [
                { Key: 'a', Value: '1' },
                { Key: 'b', Value: '2' },
            ],
        });
        expect(await s3.getObjectTagging('k')).toEqual({ a: '1', b: '2' });
        expect(cmdOf()).toBeInstanceOf(GetObjectTaggingCommand);
        expect(cmdOf().input).toEqual({ Bucket: BUCKET, Key: 'k' });

        send.mockResolvedValueOnce({});
        expect(await s3.getObjectTagging('k')).toBeUndefined();

        send.mockRejectedValueOnce(new Error('AccessDenied'));
        expect(await s3.getObjectTagging('k').catch(GETERR)).toBe('AccessDenied');
    });

    it('B18 deleteObject() sends DeleteObjectCommand', async () => {
        const s3 = new AWSS3Service();
        expect(await s3.deleteObject('').catch(GETERR)).toBe('@key (string) is required - deleteObject()');

        send.mockResolvedValueOnce({ DeleteMarker: true });
        expect(await s3.deleteObject('k')).toBeUndefined();
        expect(cmdOf()).toBeInstanceOf(DeleteObjectCommand);
        expect(cmdOf().input).toEqual({ Bucket: BUCKET, Key: 'k' });

        send.mockRejectedValueOnce(new Error('AccessDenied'));
        expect(await s3.deleteObject('k').catch(GETERR)).toBe('AccessDenied');
    });

    it('B18 listObjects() builds params, pages all, and keeps the error', async () => {
        const s3 = new AWSS3Service();

        //* default params (limit 10, delimiter '/').
        send.mockResolvedValueOnce({ Contents: [{ Key: 'a' }], MaxKeys: 10, KeyCount: 1, IsTruncated: false });
        const res = await s3.listObjects();
        expect(cmdOf()).toBeInstanceOf(ListObjectsV2Command);
        expect(cmdOf().input).toEqual({ Bucket: BUCKET, Prefix: '', Delimiter: '/', MaxKeys: 10 });
        expect(res).toEqual({
            Contents: [{ Key: 'a' }],
            MaxKeys: 10,
            KeyCount: 1,
            IsTruncated: false,
            NextContinuationToken: undefined,
        });

        //* unlimited: follow the continuation token until not truncated; limit is capped at 1000.
        send.mockReset();
        send.mockResolvedValueOnce({
            Contents: [{ Key: 'p/1' }],
            MaxKeys: 1000,
            KeyCount: 1,
            IsTruncated: true,
            NextContinuationToken: 't1',
        })
            .mockResolvedValueOnce({
                Contents: [{ Key: 'p/2' }],
                KeyCount: 1,
                IsTruncated: true,
                NextContinuationToken: 't2',
            })
            .mockResolvedValueOnce({ Contents: [{ Key: 'p/3' }], IsTruncated: false });
        const all = await s3.listObjects({
            prefix: 'p/',
            delimiter: '',
            limit: 5000,
            unlimited: true,
            nextToken: 't0',
        });
        expect(cmdOf(0).input).toEqual({
            Bucket: BUCKET,
            Prefix: 'p/',
            Delimiter: '',
            MaxKeys: 1000,
            ContinuationToken: 't0',
        });
        expect(cmdOf(1).input.ContinuationToken).toBe('t1');
        expect(cmdOf(2).input.ContinuationToken).toBe('t2');
        expect(all.Contents.map(_ => _.Key)).toEqual(['p/1', 'p/2', 'p/3']);
        expect(all.KeyCount).toBe(2);
        expect(all.IsTruncated).toBe(false);

        //* no data: keep the defaults.
        send.mockReset();
        send.mockResolvedValueOnce(undefined);
        expect(await s3.listObjects({ limit: 3 })).toEqual({ Contents: null, MaxKeys: 3, KeyCount: 0 });

        //* error: thrown by default, or kept in `.error` if not throwable.
        send.mockRejectedValueOnce(new Error('AccessDenied'));
        expect(await s3.listObjects().catch(GETERR)).toBe('AccessDenied');
        send.mockRejectedValueOnce(new Error('AccessDenied'));
        const err = await s3.listObjects({ throwable: false });
        expect(err.error).toBe('AccessDenied');
        expect(err.Contents).toBeNull();
    });
});
