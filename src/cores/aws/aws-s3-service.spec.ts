/**
 * `service/test.s3-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 * @date        2023-02-08 support of `listObject()`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'MY_S3_BUCKET';
const DEF_BUCKET = 'lemon-hello-www';

//! override environ.
process.env = Object.assign(process.env, {
    TEMP_BUCKET: 'hello-bucket',
});

//! load $engine, and prepare dummy handler
import { loadProfile } from '../../environ';
import { expect2, GETERR } from '../../common/test-helper';
import { AWSS3Service, Metadata, PutObjectResult } from './aws-s3-service';
import { $rand, my_parrallel } from '../../helpers';

const S3 = new AWSS3Service();
describe(`test AWSS3Service`, () => {
    //! use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    test('check name() function', async () => {
        expect(S3.name()).toEqual('S3');
    });

    test('check hello() function', async () => {
        expect(S3.hello()).toEqual(`aws-s3-service:${S3.bucket()}`);
    });

    test('check bucket() function', async () => {
        expect(AWSS3Service.ENV_S3_NAME).toEqual(ENV_NAME);
        expect(AWSS3Service.DEF_S3_BUCKET).toEqual(DEF_BUCKET);

        expect(S3.bucket()).toEqual(DEF_BUCKET);
        expect(S3.bucket('TEMP_BUCKET')).toEqual('hello-bucket');
        expect(S3.bucket('MY_BUCKET')).toEqual(DEF_BUCKET);
        expect(S3.bucket('my-bucket')).toEqual('my-bucket');
    });

    //! test headObject()
    test('check headObject() function', async () => {
        if (!PROFILE) return;

        // if the objects not exists
        expect(await S3.headObject('invalid-file')).toBeNull();
        // if the objects exists
        const json = JSON.stringify({ hello: 'world', lemon: true });
        const { Location: fileName } = await S3.putObject(json, 'test.json');
        // expect(await S3.headObject('invalid-file').catch(GETERR)).toMatchObject({ ContentType: 'application/json; charset=utf-8', ContentLength: json.length });
        expect(await S3.headObject('invalid-file').catch(GETERR)).toEqual(null);
        await S3.deleteObject(fileName);
    });

    //! test putObject(), and getObject()
    test('check putObject() function', async () => {
        if (!PROFILE) return;
        const json = { hello: 'world', lemon: true, name: '한글!' };
        const body = JSON.stringify(json);
        const _key = (n?: number) => `tests/sample${n ? n : ''}.json`;
        const key00 = _key();
        let res: PutObjectResult;

        //* manual key
        res = await S3.putObject(body, key00);
        expect2(() => res.Bucket).toEqual(DEF_BUCKET);
        expect2(() => res.Key).toEqual(key00);
        expect2(() => res.Location).toMatch(
            new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`),
        );
        expect2(() => res.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => res.ContentLength).toEqual(body.length + 4); // +2 due to unicode for hangul
        expect2(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        expect2(await S3.deleteObject(res.Key)).toEqual();

        //* automatic key
        res = await S3.putObject(body);
        expect2(() => res.Bucket).toEqual(DEF_BUCKET);
        expect2(() => res.Key).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/,
        );
        expect2(() => res.Location).toMatch(
            new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`),
        );
        expect2(() => res.ContentType).toEqual('application/json; charset=utf-8');
        expect2(() => res.ContentLength).toEqual(body.length + 4); // +2 due to unicode for hangul
        expect2(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        expect2(await S3.deleteObject(res.Key)).toEqual();

        //* check tags, and meta
        const meta: Metadata = { ContentType: 'application/json; charset=utf8' };
        const tags = { Company: 'LemonCloud', Service: 'lemon-core', author: 'steve' };
        res = await S3.putObject(body, key00, meta, tags);
        expect2(() => ({ ...res })).toEqual({
            Bucket: DEF_BUCKET,
            Key: key00,
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: '"51f209a54902230ac3395826d7fa1851"',
            Location: `https://${DEF_BUCKET}.s3.ap-northeast-2.amazonaws.com/${key00}`,
            Metadata: {
                ...meta,
                md5: '51f209a54902230ac3395826d7fa1851',
            },
        });
        expect2(await S3.getObject(res.Key), '!Body').toEqual({
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: '"51f209a54902230ac3395826d7fa1851"',
            Metadata: {
                //WARN - the key is changed to lower-case.
                contenttype: 'application/json; charset=utf8',
                md5: '51f209a54902230ac3395826d7fa1851',
            },
            TagCount: Object.keys(tags).length,
        });
        expect2(await S3.getObjectTagging(res.Key)).toEqual({ ...tags });
        expect2(await S3.headObject(res.Key), `!LastModified`).toEqual({
            ContentType: 'application/json; charset=utf-8',
            ContentLength: 47,
            ETag: '"51f209a54902230ac3395826d7fa1851"',
            Metadata: {
                contenttype: 'application/json; charset=utf8',
                md5: '51f209a54902230ac3395826d7fa1851',
            },
        });

        //* check list-objects
        const $list = await S3.listObjects({ prefix: 'tests/' });
        expect2(() => ({ ...$list }), 'MaxKeys').toEqual({
            MaxKeys: 10, // default is `10`
        });
        expect2(() => $list.Contents.slice(0, 1), 'Key,Size').toEqual([{ Key: 'tests/sample.json', Size: 47 }]);

        //* make sample1~10
        const MAX_COUNT = 10;
        const keys = $rand.range(MAX_COUNT).map(i => _key(i + 1));
        const objs = await my_parrallel(
            keys.map(id => ({ id })),
            N => S3.putObject(body, N.id).then(R => ({ ...N, Key: R.Key })),
        );
        expect2(() => objs?.length).toEqual(MAX_COUNT);
        if (objs) {
            // use only `limit`
            const list1 = await S3.listObjects({ prefix: 'tests/', limit: 1 });
            expect2(() => list1?.Contents.length).toEqual(1);
            expect2(() => list1, 'IsTruncated,KeyCount,MaxKeys').toEqual({
                IsTruncated: true,
                KeyCount: 1,
                MaxKeys: 1,
            });

            // use `unlimited`
            const list2 = await S3.listObjects({ prefix: 'tests/', limit: 1, unlimited: true });
            expect2(() => list2?.Contents.length).toEqual(11);
            expect2(() => list2, 'IsTruncated,KeyCount,MaxKeys,NextContinuationToken').toEqual({
                IsTruncated: false,
                KeyCount: 11,
                MaxKeys: 1,
                NextContinuationToken: undefined,
            });
            expect2(() => list2.Contents.map(N => N.Key)).toEqual([
                'tests/sample.json',
                'tests/sample1.json',
                'tests/sample10.json',
                'tests/sample2.json',
                'tests/sample3.json',
                'tests/sample4.json',
                'tests/sample5.json',
                'tests/sample6.json',
                'tests/sample7.json',
                'tests/sample8.json',
                'tests/sample9.json',
            ]);

            //* delete all objects.
            const dels = await my_parrallel(objs, N => S3.deleteObject(N.Key).then(() => ({ ...N })));
            expect2(() => dels?.length).toEqual(MAX_COUNT);

            const list3 = await S3.listObjects({ prefix: 'tests/', limit: 1, unlimited: true });
            expect2(() => list3?.Contents.length).toEqual(1);
            expect2(() => list3.Contents.map(N => N.Key)).toEqual(['tests/sample.json']);
        }

        //* cleanup object
        expect2(await S3.deleteObject(res.Key)).toEqual();
    });

    //! test getDecodedObject()
    test('check getDecodedObject() function', async () => {
        if (!PROFILE) return;
        const fileName = 'sample.json';
        const data = { hello: 'world', lemon: true };

        await S3.putObject(JSON.stringify(data), fileName);
        expect(await S3.getDecodedObject(fileName)).toEqual(data);
        await S3.deleteObject(fileName);
    });
});
