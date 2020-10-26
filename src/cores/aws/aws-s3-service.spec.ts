/**
 * `service/test.s3-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
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
import { AWSS3Service, PutObjectResult } from './aws-s3-service';
import { credentials } from '../../tools';
import { environ } from '../..';

const S3 = new AWSS3Service();

describe(`test AWSS3Service`, () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

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

    test('check headObject() function', async () => {
        if (!PROFILE) return;
        /* eslint-disable prettier/prettier */

        // if the objects not exists
        expect(await S3.headObject('invalid-file')).toBeNull();
        // if the objects exists
        const json = JSON.stringify({ hello: 'world', lemon: true });
        const { Location: fileName } = await S3.putObject(json, 'test.json');
        expect(await S3.headObject('invalid-file')).toMatchObject({ ContentType: 'application/json; charset=utf-8', ContentLength: json.length });
        await S3.deleteObject(fileName);

        /* eslint-enable prettier/prettier */
    });

    test('check putObject() function', async () => {
        if (!PROFILE) return;
        const body = JSON.stringify({ hello: 'world', lemon: true });
        let res: PutObjectResult;
        /* eslint-disable prettier/prettier */

        // manual key
        res = await S3.putObject(body, 'sample.json');
        expect(res.Bucket).toEqual(DEF_BUCKET);
        expect(res.Key).toEqual('sample.json');
        expect(res.Location).toMatch(new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`));
        expect(res.ContentType).toEqual('application/json; charset=utf-8');
        expect(res.ContentLength).toEqual(body.length);
        expect(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        await S3.deleteObject(res.Key);

        // automatic key
        res = await S3.putObject(body);
        expect(res.Bucket).toEqual(DEF_BUCKET);
        expect(res.Key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/);
        expect(res.Location).toMatch(new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`));
        expect(res.ContentType).toEqual('application/json; charset=utf-8');
        expect(res.ContentLength).toEqual(body.length);
        expect(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            Body: Buffer.from(body),
        });
        await S3.deleteObject(res.Key);

        // check tags
        const tags = { company: 'lemoncloud', service: 'lemon-core' };
        res = await S3.putObject(body, 'sample.json', null, tags);
        expect(await S3.getObject(res.Key)).toMatchObject({
            ContentType: 'application/json; charset=utf-8',
            TagCount: 2,
        });
        expect(await S3.getObjectTagging(res.Key)).toMatchObject(tags);
        await S3.deleteObject(res.Key);

        /* eslint-enable prettier/prettier */
    });

    test('check putObjectUrl() function', async () => {
        if (!PROFILE) return;
        let res: PutObjectResult;
        /* eslint-disable prettier/prettier */

        // remote image file usage
        const imageUrl = 'https://cdn.imweb.me/thumbnail/20200903/f1b871da6f28d.png';
        res = await S3.putObjectByUrl(imageUrl);
        expect(res.Bucket).toEqual(DEF_BUCKET);
        expect(res.Key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
        expect(res.Location).toMatch(new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`));
        expect(res.ContentType).toEqual('image/png; charset=utf-8');
        expect(res.ContentLength).toEqual(9015);
        expect(await S3.getObject(res.Key)).toMatchObject({ ContentType: 'image/png; charset=utf-8', ContentLength: 9015, Metadata: { origin: imageUrl, width: '433', height: '78' } });
        await S3.deleteObject(res.Key);
        // w/ directory
        res = await S3.putObjectByUrl(imageUrl, 'images');
        expect(res.Key).toMatch(/^images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
        await S3.deleteObject(res.Key);
        // w/ directory and use original file name
        res = await S3.putObjectByUrl(imageUrl, 'images', true);
        expect(res.Key).toEqual('images/f1b871da6f28d.png');
        await S3.deleteObject(res.Key);

        // local file usage
        res = await S3.putObjectByUrl('data/dummy-user-data.yml');
        expect(res.Bucket).toEqual(DEF_BUCKET);
        expect(res.Key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}\.yml$/);
        expect(res.Location).toMatch(new RegExp(`^https:\/\/${DEF_BUCKET}\.s3\.ap-northeast-2.amazonaws.com\/${res.Key}`));
        expect(res.ContentType).toEqual('text/yaml; charset=utf-8');
        expect(res.ContentLength).toEqual(148);
        expect(await S3.getObject(res.Key)).toMatchObject({ ContentType: 'text/yaml; charset=utf-8', ContentLength: 148 });
        await S3.deleteObject(res.Key);

        /* eslint-enable prettier/prettier */
    });

    test('check getDecodedObject() function', async () => {
        if (!PROFILE) return;
        const fileName = 'sample.json';
        const data = { hello: 'world', lemon: true };

        await S3.putObject(JSON.stringify(data), fileName);
        expect(await S3.getDecodedObject(fileName)).toEqual(data);
        await S3.deleteObject(fileName);
    });
});
