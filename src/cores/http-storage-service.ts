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
const NS = $U.NS('STRS', 'green'); // NAMESPACE TO BE PRINTED.
import { APIService, APIServiceClient, APIHeaders } from './api-service';
import { StorageModel, StorageService } from './storage-service';
/**
 * only for type information for internal partition-key.
 */

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
        const node = { ...item, $inc };
        return this.service.doPut(id, undefined, null, node);
    }

    public async increment(id: string, $inc: T, $upt?: T): Promise<T> {
        if (!id) throw new Error('@id is required!');
        if (!id.trim()) throw new Error('@id (string) is required!');
        if (!$inc && !$upt) throw new Error('@item is required!');
        const node = { ...$upt, $inc };
        return this.service.doPut(id, undefined, null, node);
    }

    public async delete(id: string): Promise<T> {
        return this.service.doDelete(id);
    }
}
