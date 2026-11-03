/**
 * `lambda-web-chain.spec.ts`
 * - nested `{proxy+}` paths on the default route (`/houses/A/rooms/304`), resolved by the model `FIELDS`.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-11-03 initial version (v5 proxy decode).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, it } from 'vitest';
import { NextHandler } from 'lemon-model';
import { expect2 } from '../../common/test-helper';
import { GeneralWEBController } from '../../controllers/general-controller';
import { LambdaWEBHandler } from './lambda-web-handler';
import { LambdaHandler } from './lambda-handler';
import { parentKeyIn } from './lambda-web-chain';

//* a fake CRUD-like controller: GeneralWEBController + `manager` (FIELDS, retrieve) + recording handlers.
const fake = (
    type: string,
    FIELDS: string[],
    rows: { [id: string]: any },
    extra: { [name: string]: NextHandler } = {},
) => {
    const c: any = new GeneralWEBController(type);
    const rec =
        (via: string): NextHandler =>
        async (id, param, body) => ({ via: `${type}.${via}`, id, param, body });
    Object.assign(
        c,
        {
            doList: rec('doList'),
            doGet: rec('doGet'),
            doPost: rec('doPost'),
            doPut: rec('doPut'),
            doDelete: rec('doDelete'),
        },
        extra,
    );
    c.manager = {
        FIELDS,
        retrieve: async (id: string) => rows[id] ?? Promise.reject(new Error(`404 NOT FOUND - ${type}:${id}`)),
    };
    c.rec = rec;
    return c;
};

//* houses A,B · rooms 304(A, user 9), 305(B), 306(home H) · beds 1(room 304) · users 9 · boards 1
const setup = () => {
    const web = new LambdaWEBHandler(new LambdaHandler(), true);
    const houses = fake('houses', ['id', 'name'], { A: { id: 'A' }, B: { id: 'B' } });
    const rooms = fake('rooms', ['id', 'name', 'houseId', 'userId', 'homeId'], {
        304: { id: '304', houseId: 'A', userId: '9' },
        305: { id: '305', houseId: 'B' },
        306: { id: '306', homeId: 'H' },
    });
    const beds = fake('beds', ['id', 'roomId'], { 1: { id: '1', roomId: '304' } });
    const users = fake('users', ['id', 'name'], { 9: { id: '9' } });
    const boards = fake('boards', ['id', 'title'], { 1: { id: '1' } });
    [houses, rooms, beds, users, boards].forEach(c => web.addController(c));
    const call = (
        mode: string,
        type: string,
        id: string,
        cmd: string,
        param: any = {},
        body: any = null,
    ): Promise<any> => web.handleProtocol({ mode, type, id, cmd, param, body, context: {} } as any);
    return { web, call, houses, rooms };
};

//* the error code part (`404 NOT FOUND`, `400 CONFLICT`, ...), or 'OK'.
const codeOf = (p: Promise<any>): Promise<string> =>
    p.then(
        () => 'OK',
        e => `${e.message}`.split(' - ')[0],
    );

describe('lambda-web-chain', () => {
    it('R-01 GET houses A rooms/304', async () => {
        const { call } = setup();
        await expect2(() => call('GET', 'houses', 'A', 'rooms/304')).toEqual({
            via: 'rooms.doGet',
            id: '304',
            param: { houseId: 'A' },
            body: null,
        });
    });

    it('R-02 / R-10 room of another house', async () => {
        const { call } = setup();
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms/305'))).toEqual('404 NOT FOUND');
        await expect2(() => codeOf(call('DELETE', 'houses', 'A', 'rooms/305'))).toEqual('404 NOT FOUND');
    });

    it('R-05 query parent key differs from path', async () => {
        const { call } = setup();
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms/304', { houseId: 'B' }))).toEqual('400 CONFLICT');
        await expect2(() => call('GET', 'houses', 'A', 'rooms/304', { houseId: 'A' }), 'param').toEqual({
            param: { houseId: 'A' },
        });
    });

    it('R-06 existing parent method wins', async () => {
        const { call, houses } = setup();
        houses.getHousesRooms = houses.rec('getHousesRooms');
        await expect2(() => call('GET', 'houses', 'A', 'rooms'), 'via,id').toEqual({
            via: 'houses.getHousesRooms',
            id: 'A',
        });
    });

    it('R-07 GET houses A rooms (no target id, mode kept)', async () => {
        const { call } = setup();
        await expect2(() => call('GET', 'houses', 'A', 'rooms'), 'via,id,param').toEqual({
            via: 'rooms.doGet',
            id: '',
            param: { houseId: 'A' },
        });
    });

    it('R-08 POST fills the parent key in body', async () => {
        const { call } = setup();
        await expect2(() => call('POST', 'houses', 'A', 'rooms', {}, { name: 'r' }), 'via,id,body').toEqual({
            via: 'rooms.doPost',
            id: '',
            body: { name: 'r', houseId: 'A' },
        });
        await expect2(() => codeOf(call('POST', 'houses', 'A', 'rooms', {}, { houseId: 'B' }))).toEqual('400 CONFLICT');
        await expect2(() => call('POST', 'houses', 'A', 'rooms/0', {}, {}), 'via,id,body').toEqual({
            via: 'rooms.doPost',
            id: '0',
            body: { houseId: 'A' },
        });
    });

    it('R-09 PUT keeps the body (move by body)', async () => {
        const { call } = setup();
        await expect2(() => call('PUT', 'houses', 'A', 'rooms/304', {}, { houseId: 'B' }), 'via,id,body').toEqual({
            via: 'rooms.doPut',
            id: '304',
            body: { houseId: 'B' },
        });
    });

    it('R-11 no parent key in child FIELDS', async () => {
        const { call } = setup();
        await expect2(() => codeOf(call('GET', 'boards', '1', 'rooms/304'))).toEqual('404 NOT FOUND');
    });

    it('R-12 GET users 9 rooms/304', async () => {
        const { call } = setup();
        await expect2(() => call('GET', 'users', '9', 'rooms/304'), 'via,param').toEqual({
            via: 'rooms.doGet',
            param: { userId: '9' },
        });
    });

    it('R-13 two links', async () => {
        const { call } = setup();
        await expect2(() => call('GET', 'houses', 'A', 'rooms/304/beds/1'), 'via,id,param').toEqual({
            via: 'beds.doGet',
            id: '1',
            param: { houseId: 'A', roomId: '304' },
        });
        await expect2(() => codeOf(call('GET', 'houses', 'B', 'rooms/304/beds/1'))).toEqual('404 NOT FOUND');
    });

    it('R-14 command on the child', async () => {
        const { call, rooms } = setup();
        rooms.postRoomsCheckIn = rooms.rec('postRoomsCheckIn');
        await expect2(() => call('POST', 'houses', 'A', 'rooms/304/check-in'), 'via,id,param').toEqual({
            via: 'rooms.postRoomsCheckIn',
            id: '304',
            param: { houseId: 'A' },
        });
    });

    it('R-14b existing method first at each step', async () => {
        const { call, rooms } = setup();
        rooms.getRoomsBeds = rooms.rec('getRoomsBeds');
        await expect2(() => call('GET', 'houses', 'A', 'rooms/304/beds'), 'via,id').toEqual({
            via: 'rooms.getRoomsBeds',
            id: '304',
        });
    });

    it('R-23 invalid path pieces', async () => {
        const { call } = setup();
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms//304'))).toEqual('400 INVALID PATH');
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms/..'))).toEqual('400 INVALID PATH');
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms/$x'))).toEqual('400 INVALID PATH');
    });

    it('R-23b `{id+}` stays on the first step', async () => {
        const { web, call } = setup();
        web.addController(fake('images', ['id'], {}));
        await expect2(() => call('GET', 'images', 'a/b/c.png', ''), 'via,id').toEqual({
            via: 'images.doGet',
            id: 'a/b/c.png',
        });
    });

    it('R-24 fallback to the parent method with `$sub`', async () => {
        const { web, call } = setup();
        const files = fake('files', ['id'], {});
        files.getFilesDownload = files.rec('getFilesDownload');
        web.addController(files);
        await expect2(() => call('GET', 'files', '0', 'download/a/b'), 'via,id,param').toEqual({
            via: 'files.getFilesDownload',
            id: '0',
            param: { $sub: 'a/b' },
        });
    });

    it('R-26 id is not decoded again', async () => {
        const { call, rooms } = setup();
        const seen: string[] = [];
        const retrieve = rooms.manager.retrieve;
        rooms.manager.retrieve = (id: string) => (seen.push(id), retrieve(id));
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms/a%20b'))).toEqual('404 NOT FOUND');
        expect2(() => seen).toEqual(['a%20b']);
    });

    it('R-27 function decoder as the parent', async () => {
        const { web, call } = setup();
        web.setHandler('homes', () => null);
        await expect2(() => call('GET', 'homes', 'H', 'rooms/306'), 'via,id,param').toEqual({
            via: 'rooms.doGet',
            id: '306',
            param: { homeId: 'H' },
        });
    });

    it('R-28 child without manager', async () => {
        const { web, call } = setup();
        web.addController(new GeneralWEBController('notes'));
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'notes/1'))).toEqual('404 NOT FOUND');
    });

    it('R-29 client `$sub` is dropped', async () => {
        const { call } = setup();
        await expect2(() => call('GET', 'houses', 'A', 'rooms/304', { $sub: 'x' }), 'param').toEqual({
            param: { houseId: 'A' },
        });
    });

    it('R-29b client `$sub` is dropped on the first step too', async () => {
        const { web, call } = setup();
        const files = fake('files', ['id'], {});
        files.getFilesDownload = files.rec('getFilesDownload');
        web.addController(files);
        await expect2(() => call('GET', 'files', '0', 'download', { $sub: 'x' }), 'via,param').toEqual({
            via: 'files.getFilesDownload',
            param: {},
        });
    });

    it('R-24b fallback only at the deepest level', async () => {
        const { call, houses, rooms } = setup();
        houses.getHousesRooms = houses.rec('getHousesRooms');
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms/304/typo'))).toEqual('404 NOT FOUND');
        rooms.getRoomsDownload = rooms.rec('getRoomsDownload');
        await expect2(() => call('GET', 'houses', 'A', 'rooms/304/download/a/b'), 'via,id,param').toEqual({
            via: 'rooms.getRoomsDownload',
            id: '304',
            param: { houseId: 'A', $sub: 'a/b' },
        });
        await expect2(() => codeOf(call('GET', 'houses', 'B', 'rooms/304/download/a/b'))).toEqual('404 NOT FOUND');
    });

    it('R-08b POST body parent key `null`/`` counts as missing', async () => {
        const { call } = setup();
        await expect2(() => call('POST', 'houses', 'A', 'rooms', {}, { houseId: null }), 'body').toEqual({
            body: { houseId: 'A' },
        });
        await expect2(() => call('POST', 'houses', 'A', 'rooms', {}, { houseId: '' }), 'body').toEqual({
            body: { houseId: 'A' },
        });
    });

    it('R-30 parentKeyIn()', () => {
        expect2(() => parentKeyIn('categories', ['categoryId'])).toEqual('categoryId');
        expect2(() => parentKeyIn('site-users', ['siteUserId'])).toEqual('siteUserId');
        expect2(() => parentKeyIn('boxes', ['boxId'])).toEqual('boxId');
        expect2(() => parentKeyIn('houses', ['name'])).toEqual(null);
    });

    it('R-31 non-404 error of retrieve propagates', async () => {
        const { call, rooms } = setup();
        rooms.manager.retrieve = async () => Promise.reject(new Error('500 DB'));
        await expect2(() => codeOf(call('GET', 'houses', 'A', 'rooms/304'))).toEqual('500 DB');
    });

    it('R-03 / R-04 / R-04b / R-04c query parent key on a direct route', async () => {
        const { call, rooms } = setup();
        await expect2(() => call('GET', 'rooms', '304', ''), 'via,id').toEqual({ via: 'rooms.doGet', id: '304' });
        await expect2(() => codeOf(call('GET', 'rooms', '304', '', { houseId: 'B' }))).toEqual('404 NOT FOUND');
        await expect2(() => call('GET', 'rooms', '304', '', { houseId: 'A' }), 'via,param').toEqual({
            via: 'rooms.doGet',
            param: { houseId: 'A' },
        });
        //* R-04b: mode does not matter.
        await expect2(() => codeOf(call('PUT', 'rooms', '304', '', { houseId: 'B' }, {}))).toEqual('404 NOT FOUND');
        //* R-04c: `owners` is not registered, so no check (and no retrieve).
        const calls: string[] = [];
        const retrieve = rooms.manager.retrieve;
        rooms.manager.retrieve = async (id: string) => (calls.push(id), retrieve(id));
        await expect2(() => call('GET', 'rooms', '304', '', { ownerId: 'x' }), 'via').toEqual({ via: 'rooms.doGet' });
        await expect2(() => call('GET', 'rooms', '304'), 'via').toEqual({ via: 'rooms.doGet' });
        await expect2(() => call('POST', 'rooms', '0', '', { houseId: 'B' }, {}), 'via').toEqual({
            via: 'rooms.doPost',
        });
        await expect2(() => call('LIST', 'rooms', '', '', { houseId: 'B' }), 'via').toEqual({ via: 'rooms.doList' });
        expect2(() => calls).toEqual([]);
    });
});

describe('prefix', () => {
    //* the prefix controllers: `houses`, `rooms` (and `boards` registered on the default route only).
    const prefixed = () => {
        const S = setup();
        const houses = fake('houses', ['id', 'name'], { A: { id: 'A' }, B: { id: 'B' } });
        const rooms = fake('rooms', ['id', 'houseId'], { 304: { id: '304', houseId: 'A' } });
        S.web.addPrefix('public', [houses, rooms]);
        return { ...S, houses, rooms };
    };

    it('R-16 GET public houses A', async () => {
        const { call } = prefixed();
        await expect2(() => call('GET', 'public', 'houses', 'A'), 'via,id').toEqual({ via: 'houses.doGet', id: 'A' });
    });

    it('R-17 GET public houses (mode kept)', async () => {
        const { call } = prefixed();
        await expect2(() => call('GET', 'public', 'houses', ''), 'via,id').toEqual({ via: 'houses.doGet', id: '' });
    });

    it('R-18 GET public houses A/rooms/304', async () => {
        const { call } = prefixed();
        await expect2(() => call('GET', 'public', 'houses', 'A/rooms/304'), 'via,id,param').toEqual({
            via: 'rooms.doGet',
            id: '304',
            param: { houseId: 'A' },
        });
        await expect2(() => codeOf(call('GET', 'public', 'houses', 'B/rooms/304'))).toEqual('404 NOT FOUND');
    });

    it('R-18b type not in the prefix list', async () => {
        const { call } = prefixed();
        await expect2(() => codeOf(call('GET', 'public', 'boards', '1'))).toEqual('404 NOT FOUND');
        await expect2(() => codeOf(call('GET', 'nope', 'houses', 'A'))).toEqual('404 NOT FOUND');
    });

    it('R-19 identity replaces context.identity', async () => {
        const { web } = setup();
        const rooms = fake('rooms', ['id'], {});
        rooms.doGet = async (id: string, _p: any, _b: any, c: any) => ({ id, identity: c.identity, sid: c.sid });
        web.addPrefix('_api_', [rooms], { identity: async () => ({ sid: 'S' }) });
        const context: any = { sid: 'X', identity: { sid: 'old' } };
        const param: any = { mode: 'GET', type: '_api_', id: 'rooms', cmd: '304', param: {}, body: null, context };
        await expect2(() => web.handleProtocol(param)).toEqual({ id: '304', identity: { sid: 'S' }, sid: 'X' });
        expect2(() => context.identity).toEqual({ sid: 'old' });
        //* the identity error propagates as is.
        web.addPrefix('_bad_', [rooms], { identity: async () => Promise.reject(new Error('403 FORBIDDEN - no key')) });
        await expect2(() => web.handleProtocol({ ...param, type: '_bad_' })).toEqual('403 FORBIDDEN - no key');
    });

    it('R-20 duplicated prefix', async () => {
        const { web, houses } = prefixed();
        expect2(() => web.addPrefix('public', [houses])).toEqual('@prefix[public] is duplicated!');
    });

    it('R-21 GET _key_ apikeys K1', async () => {
        const { web, call } = setup();
        web.addPrefix('_key_', [fake('apikeys', ['id'], {})]);
        await expect2(() => call('GET', '_key_', 'apikeys', 'K1'), 'via,id').toEqual({
            via: 'apikeys.doGet',
            id: 'K1',
        });
    });

    it('R-22 POST public houses A', async () => {
        const { call } = prefixed();
        await expect2(() => call('POST', 'public', 'houses', 'A', {}, { x: 1 }), 'via,id').toEqual({
            via: 'houses.doPost',
            id: 'A',
        });
    });

    it('R-25 registered type wins over the prefix', async () => {
        const { web, call } = setup();
        web.addController(fake('_keys', [], {}));
        web.addController(fake('public', [], {}));
        web.addPrefix('public', [fake('houses', ['id'], {})]);
        web.addPrefix('_key_', [fake('apikeys', ['id'], {})]);
        await expect2(() => call('GET', 'public', 'houses', ''), 'via,id').toEqual({
            via: 'public.doGet',
            id: 'houses',
        });
        await expect2(() => call('GET', '_keys', 'K1', ''), 'via,id').toEqual({ via: '_keys.doGet', id: 'K1' });
    });
});
