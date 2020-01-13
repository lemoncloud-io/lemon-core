/**
 * API: `general-api-controllers.ts`
 * - common controller class
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-03 initial version
 * @date        2020-01-07 refactoring with `GeneralWEBController`
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
/** ********************************************************************************************************************
 *  Common Headers
 ** ********************************************************************************************************************/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../engine/';
import { NUL404 } from '../common/test-helper';
import { GeneralWEBController } from './general-controller';
import { NextHandler, Elastic6SimpleQueriable } from '../cores/core-types';
import { CoreModel, TypedStorageService, UniqueFieldManager } from '../cores/proxy-storage-service';

/**
 * class: `APIController`
 * - support basic CRUD with TypedManager
 */
export class GeneralAPIController<
    T extends TypedStorageService<CoreModel<ModelType>, ModelType>,
    ModelType extends string
> extends GeneralWEBController {
    public readonly NS: string;
    protected storage: T;
    protected search: Elastic6SimpleQueriable<any>;
    protected unique: UniqueFieldManager<CoreModel<ModelType>, ModelType>;

    /**
     * default constructor
     * @param type      type of REST API
     * @param storage   storage-service
     * @param search    search-service
     * @param uniqueField (optional) field in unique to lookup the origin id.
     */
    public constructor(type: string, storage: T, search: Elastic6SimpleQueriable<any>, uniqueField?: string) {
        super(type);
        this.NS = $U.NS(`*${type}`, 'yellow'); // NAMESPACE TO BE PRINTED.
        this.storage = storage;
        this.search = search;
        this.unique = uniqueField ? storage.makeUniqueFieldManager(uniqueField) : null;
    }

    /**
     * name of this resource.
     */
    public hello = () => `general-api-controller:${this.type()}`;

    /**
     * override decoder of function-name.
     * 1. try to find default.
     * 2. use 'base' function.
     */
    public asFuncName(mode: string, type?: string, cmd?: string) {
        const func1 = super.asFuncName(mode, type, cmd); // use origin.
        if ((this as any)[func1]) return func1;
        const func2 = super.asFuncName(mode, 'base', cmd); // use like `getBase()`
        return func2;
    }

    /**
     * search node
     *
     */
    public listBase: NextHandler = async (id, param, body, context) => {
        _log(this.NS, `! listBase(${id})..`);
        param = param || {};

        //! translate page + ipp => page & limit.
        const $page = $U.N(param.page, 0);
        const $limit = $U.N(param.limit, $U.N(param.ipp, 12)); // compartible for ipp
        const $param = { ...param, $page, $limit, page: undefined, ipp: undefined, limit: undefined }; // clear paging param.
        $param.$O = $param.$O || 'id.keyword'; // order by id

        //! base filter masking.
        if (param.type === undefined) $param.type = this.type();
        if (param.deletedAt === undefined) $param.deletedAt = 0;
        if (this.unique && param.stereo === undefined) $param['!stereo'] = '#'; //! `.stereo` is not like '#'

        //! call search.
        return this.search.searchSimple($param);
    };

    /**
     * read node
     */
    public getBase: NextHandler = async (id, param, body, context) => {
        _log(this.NS, `! getBase(${id})..`);
        return this.storage.read(id);
    };

    /**
     * update node.
     * - throw error if not found.
     */
    public putBase: NextHandler = async (id, param, body, context) => {
        _log(this.NS, `! putBase(${id})..`);
        id = `${id || ''}`.trim();
        if (!id) throw new Error('@id (string) is required!');
        const $org = await this.storage.read(id);
        //! if try to update 'unique-field', then update lookup.
        const field = this.unique ? this.unique.field : '';
        const $base: CoreModel<ModelType> =
            field && body[field] ? await this.unique.updateLookup($org, body[field]) : {};
        const res = await this.storage.save(id, body);
        return { ...$base, ...res, id };
    };

    /**
     * save (or create) node.
     */
    public postBase: NextHandler = async (id, param, body, context) => {
        _log(this.NS, `! postBase(${id})..`);
        id = `${id || ''}`.trim();
        if (!id) throw new Error('@id (string) is required!');
        id = id == '0' ? '' : id; // clear id.
        //! if try to update 'unique-field', then update lookup.
        const field = this.unique ? this.unique.field : '';
        const $base: CoreModel<ModelType> =
            field && body[field] ? await this.unique.updateLookup({ id, [field]: body[field] }) : {};
        id = id || $base.id;
        //! if no id found, then try to make new one.
        if (!id) {
            const $id = await this.storage.insert({ type: this.storage.type });
            const res = await this.storage.save($id.id, body);
            return { ...res, ...$id };
        } else {
            const res = await this.storage.save(id, body);
            return { ...$base, ...res, id };
        }
    };

    /**
     * delete (or destroy) node
     */
    public deleteBase: NextHandler = async (id, param, body, context) => {
        _log(this.NS, `! deleteBase(${id})..`);
        param = param || {};
        const destroy = $U.N(param.destroy, param.destroy === '' ? 1 : 0) ? true : false;
        //! destroy for lookup-id (TBD - need to destory lookup-key really?)
        const field = this.unique ? this.unique.field : '';
        if (destroy && this.unique) {
            const $org = await this.storage.read(id).catch(NUL404);
            const old = $org ? ($org as any)[field] : '';
            if (old) await this.storage.delete(this.unique.asLookupId(old), destroy);
        }
        //! destroy key...
        return this.storage.delete(id, destroy);
    };
}
