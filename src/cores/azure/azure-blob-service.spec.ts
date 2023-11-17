/**
 * `service/test.s3-service.ts`
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-18 support azure blob service
 * 
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
const ENV_NAME = 'my-blob-container';
const DEF_BUCKET = 'blob-container';

//! load $engine, and prepare dummy handler

import { expect2, GETERR } from '../../common/test-helper';
import { BlobService, PutObjectResult } from './azure-blob-service';
import { Metadata } from '@azure/storage-blob';
import { $rand, my_parrallel } from '../../helpers';

const BLOB = new BlobService();
jest.setTimeout(25000);
describe(`test BlobService`, () => {
    //! use `env.PROFILE`

    test('check name() function', async () => {
        expect(BLOB.name()).toEqual('BLOB');
    });

    test('check hello() function', async () => {
        expect(BLOB.hello()).toEqual(`azure-blob-service:${BLOB.bucket()}`);
    });

    test('check bucket() function', async () => {
        expect(BLOB.bucket()).toEqual(DEF_BUCKET);
    });

    //! test headObject()
    test('check headObject() function', async () => {
        // if the objects not exists
        expect(await BLOB.headObject('invalid-file')).toBeNull();
        // if the objects exists
        const json = JSON.stringify({ hello: 'world', lemon: true });
        await BLOB.putObject(json, 'test.json');
        expect(await BLOB.headObject('invalid-file').catch(GETERR)).toEqual(null);
        await BLOB.deleteObject("test.json");
    });

    //! test putObject(), and getObject()
    test('check putObject() function', async () => {
        const json = { hello: 'world', lemon: true, name: '한글!' };
        const body = JSON.stringify(json);
        const _key = (n?: number) => `tests/sample${n ? n : ''}.json`;
        const key00 = _key();   //tests/sample.json
        let res: PutObjectResult;

        //* manual key
        res = await BLOB.putObject(body, key00);
        expect2(() => res.Bucket).toEqual(DEF_BUCKET);
        expect2(() => res.Key).toEqual(key00);

        //Azure Blob Storage does not include region information in its URLs.
        expect2(() => res.Location).toEqual("koreacentral");
        expect2(() => res.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => res.ContentLength).toEqual(body.length + 4); // +2 due to unicode for hangul
        expect2(await BLOB.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: body,
        });
        expect2(await BLOB.deleteObject(res.Key)).toEqual();

        //* automatic key
        res = await BLOB.putObject(body);
        expect2(() => res.Bucket).toEqual(DEF_BUCKET);
        expect2(() => res.Key).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/,
        );
        //Azure Blob Storage does not include region information in its URLs.
        expect2(() => res.Location).toEqual("koreacentral");
        expect2(() => res.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => res.ContentLength).toEqual(body.length + 4); // +2 due to unicode for hangul
        expect2(await BLOB.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: body,
        });
        expect2(await BLOB.deleteObject(res.Key)).toEqual();

        //* check tags, and meta
        const meta: Metadata = { ContentType: 'application/json; charset=utf-8' };
        const tags = { Company: 'LemonCloud', Service: 'lemon-core', author: 'steve' };
        res = await BLOB.putObject(body, key00, meta, tags);

        expect2(() => ({ ...res })).toMatchObject({
            Bucket: DEF_BUCKET,
            Key: key00,
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: /^"[\da-fA-F]+"/,
            Location: `koreacentral`,
            Metadata: {
                ContentType: 'application/json; charset=utf-8'
            },
        });
        expect2(await BLOB.getObject(res.Key), '!Body').toMatchObject({
            ContentLength: 47,
            ContentType: 'application/json; charset=utf-8',
            ETag: /^"[\da-fA-F]+"/,
            Metadata: {
                contenttype: 'application/json; charset=utf-8',
            },
            TagCount: Object.keys(tags).length,
        });

        expect2(await BLOB.getObjectTagging(res.Key)).toEqual({ ...tags });
        expect2(await BLOB.headObject(res.Key), `!LastModified`).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: /^"[\da-fA-F]+"/,
            Metadata: {
                contenttype: 'application/json; charset=utf-8',
            },
        });

        //* check list-objects
        const $list = await BLOB.listObjects({ prefix: 'tests/' });
        // console.log("$list: ", $list)
        expect2(() => ({ ...$list }), 'MaxKeys').toEqual({
            MaxKeys: 10, // default is `10`
        });
        expect2(() => $list.Contents.slice(0, 1), 'Key,Size').toEqual([{ Key: 'sample.json', Size: 47 }]);

        //* make sample1~10
        const MAX_COUNT = 10;
        const keys = $rand.range(MAX_COUNT).map(i => _key(i + 1));
        const objs = await my_parrallel(
            keys.map(id => ({ id })),
            N => BLOB.putObject(body, N.id).then(R => ({ ...N, Key: R.Key })),
        );
        expect2(() => objs?.length).toEqual(MAX_COUNT);
        if (objs) {
            // use only `limit`
            const list1 = await BLOB.listObjects({ prefix: 'tests/', limit: 1 });
            expect2(() => list1?.Contents.length).toEqual(1);
            expect2(() => list1, 'IsTruncated,KeyCount,MaxKeys').toEqual({
                IsTruncated: true,
                KeyCount: 1,
                MaxKeys: 1,
            });
            // use `unlimited`
            const list2 = await BLOB.listObjects({ prefix: 'tests/', limit: 1, unlimited: true });
            expect2(() => list2?.Contents.length).toEqual(11);
            expect2(() => list2, 'IsTruncated,KeyCount,MaxKeys,NextContinuationToken').toEqual({
                IsTruncated: false,
                KeyCount: 11,
                MaxKeys: 1,
                NextContinuationToken: undefined,
            });
            expect2(() => list2.Contents.map((N: any) => N.Key)).toEqual([
                'sample.json',
                'sample1.json',
                'sample10.json',
                'sample2.json',
                'sample3.json',
                'sample4.json',
                'sample5.json',
                'sample6.json',
                'sample7.json',
                'sample8.json',
                'sample9.json',
            ]);

            //* delete all objects.
            const dels = await my_parrallel(objs, N => BLOB.deleteObject(N.Key).then(() => ({ ...N })));
            expect2(() => dels?.length).toEqual(MAX_COUNT);

            const list3 = await BLOB.listObjects({ prefix: 'tests/', limit: 1, unlimited: true });
            expect2(() => list3?.Contents.length).toEqual(1);
            expect2(() => list3.Contents.map((N: any) => N.Key)).toEqual(['sample.json']);
        }

        //* cleanup object
        expect2(await BLOB.deleteObject(res.Key)).toEqual();
    });

    test('check continuation token', async () => {
        const json = { hello: 'world', lemon: true, name: '한글!' };
        const body = JSON.stringify(json);
        const _key = (n?: number) => `tests/sample${n ? n : ''}.json`;

        const MAX_COUNT = 20;
        const keys = $rand.range(MAX_COUNT).map(i => _key(i + 1));
        const objs = await my_parrallel(
            keys.map(id => ({ id })),
            N => BLOB.putObject(body, N.id).then(R => ({ ...N, Key: R.Key })),
        );
        expect2(() => objs?.length).toEqual(MAX_COUNT);

        const list = await BLOB.listObjects({ prefix: 'tests/', limit: 1, unlimited: true });
        expect2(() => list, 'IsTruncated,KeyCount,MaxKeys,NextContinuationToken').toEqual({
            IsTruncated: false,
            KeyCount: 20,
            MaxKeys: 1,
            NextContinuationToken: undefined,
        });
        expect2(() => list.Contents.map((N: any) => N.Key)).toEqual([
            'sample1.json',
            'sample10.json',
            'sample11.json',
            'sample12.json',
            'sample13.json',
            'sample14.json',
            'sample15.json',
            'sample16.json',
            'sample17.json',
            'sample18.json',
            'sample19.json',
            'sample2.json',
            'sample20.json',
            'sample3.json',
            'sample4.json',
            'sample5.json',
            'sample6.json',
            'sample7.json',
            'sample8.json',
            "sample9.json",
        ]);
        const list2 = await BLOB.listObjects({ prefix: 'tests/', limit: 2, unlimited: true });
        expect2(() => list2, 'IsTruncated,KeyCount,MaxKeys,NextContinuationToken').toEqual({
            IsTruncated: false,
            KeyCount: 10,
            MaxKeys: 2,
            NextContinuationToken: undefined,
        });
        let nextToken = undefined;
        for (let i = 0; i < 20; i++) {
            const list: any = await BLOB.listObjects({ prefix: 'tests/', limit: 1, nextToken });
            nextToken = list.NextContinuationToken;
            expect2(() => list, 'IsTruncated,KeyCount,MaxKeys').toEqual({
                IsTruncated: true,
                KeyCount: 1,
                MaxKeys: 1,
            });
            expect2(() => list, 'NextContinuationToken').not.toBeNull();
        }
        nextToken = undefined;
        for (let i = 0; i < 10; i++) {
            const list: any = await BLOB.listObjects({ prefix: 'tests/', limit: 2, nextToken });
            nextToken = list.NextContinuationToken;
            expect2(() => list, 'IsTruncated,KeyCount,MaxKeys').toEqual({
                IsTruncated: true,
                KeyCount: 1,
                MaxKeys: 2,
            });
            expect2(() => list, 'NextContinuationToken').not.toBeNull();
        }

        //* delete all objects.
        const dels = await my_parrallel(objs, N => BLOB.deleteObject(N.Key).then(() => ({ ...N })));
        expect2(() => dels?.length).toEqual(MAX_COUNT);
    });


    //! test getDecodedObject()
    test('check getDecodedObject() function', async () => {
        const fileName = 'sample.json';
        const data = { hello: 'world', lemon: true };

        await BLOB.putObject(JSON.stringify(data), fileName);
        expect(await BLOB.getDecodedObject(fileName)).toEqual(data);
        await BLOB.deleteObject(fileName);
    });

});
