/**
 * `storage-service.js`
 * - common service for `storage`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-26 initial version
 * @date        2019-10-01 moved from ticket-data-service to storage-service.
 * @date        2019-12-01 migrated to storage-service.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../engine';
import { APIService, APIServiceClient, APIHeaders } from './api-service';
import { StorageModel, StorageService } from './storage-service';
const NS = $U.NS('STRS', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * class: `HttpStorageService`
 */
export class HttpStorageService<T extends StorageModel> implements StorageService<T> {
    private endpoint: string;
    private idName: string;
    private service: APIServiceClient;
    public constructor(endpoint: string, type: string, idName?: string) {
        _log(NS, `HttpStorageService(${endpoint || ''})...`);
        if (!endpoint) throw new Error('@endpoint(string) is required!');
        this.idName = `${idName || 'id'}`;
        const TYPE = type;
        this.endpoint = endpoint;
        const HEADERS: APIHeaders = { 'content-type': 'application/x-www-form-urlencoded' };
        this.service = new APIService(TYPE, endpoint, HEADERS, APIService.buildClient(TYPE, endpoint, null, ''));
    }

    /**
     * say hello()
     * @param name  (optional) given name
     */
    public hello = () => `http-storage-service:${this.endpoint}/${this.idName}`;

    public async read(id: string): Promise<T> {
        if (!id.trim()) throw new Error('@id (string) is required!');
        return this.service.doGet(id);
    }

    public async readOrCreate(id: string, model: T): Promise<T> {
        //return this.service.doGet(id); //TODO
        return this.service.doGet(id).catch(e => {
            if (`${e.message}`.startsWith('404 NOT FOUND')) return this.save(id, model);
            throw e;
        });
    }

    public async save(id: string, item: T): Promise<T> {
        return this.service.doPost(id, undefined, null, item);
    }

    public async update(id: string, item: T, $inc?: T): Promise<T> {
        const $I = await this.validateIncrement(id, $inc);
        const node = { ...item, ...$I };
        return this.service.doPut(id, undefined, null, node);
    }

    public async increment(id: string, $inc: T, $upt?: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!id.trim()) throw new Error('@id (string) is required!');
        if (!$inc && !$upt) throw new Error('@item is required!');

        const $I = await this.validateIncrement(id, $inc);

        const node = { ...$upt, ...$I };
        return this.service.doPut(id, undefined, null, node);
    }

    public async delete(id: string): Promise<T> {
        return this.service.doDelete(id);
    }

    public async validateIncrement(id: string, $inc: T): Promise<T> {
        const $org: any = await this.read(id).catch(e => {
            if (`${e.message || e}`.startsWith('404 NOT FOUND')) return { id };
            throw e;
        });
        if (!$inc) return null;
        const $I = Object.entries($inc).reduce((N: any, cur) => {
            const key = cur[0];
            const val = cur[1];
            if (val !== undefined) {
                const org = ($org as any)[key];
                //! check type matched!
                if (org !== undefined && typeof org === 'number' && typeof val !== 'number')
                    throw new Error(`.${key} (${val}) should be number!`);
                //! if not exists, update it.
                if (org === undefined) {
                    N[key] = val;
                } else if (typeof val !== 'number') {
                    N[key] = val;
                } else {
                    N[key] = org + val;
                }
            }
            return N;
        }, {});
        return $I;
    }
}
