/**
 * `model-manager.ts`
 * - base model manager
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-06-05 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../engine/';
import {
    CoreModel,
    StorageMakeable,
    GeneralModelFilter,
    TypedStorageService,
    UniqueFieldManager,
} from './proxy-storage-service';

const NS = $U.NS('MMGR', 'cyan'); // NAMESPACE TO BE PRINTED.

/**
 * class: `AbstractManager`
 *  - abstract model manager to cover all models extending CoreModel.
 *  - handle 'name' like unique value in same type.
 *  - typed-storage based.
 * @abstract
 */
export abstract class AbstractManager<
    T extends CoreModel<ModelType>,
    S extends StorageMakeable<T, ModelType>,
    ModelType extends string
> extends GeneralModelFilter<T, ModelType> {
    public readonly type: ModelType;
    public readonly parent: S;
    public readonly storage: TypedStorageService<T, ModelType>;
    public readonly $unique: UniqueFieldManager<T, ModelType>;

    protected constructor(type: ModelType, parent: S, fields: string[], uniqueField?: string) {
        super(fields);
        this.type = type;
        this.parent = parent;
        this.storage = parent.makeStorageService(type, fields, this);
        this.$unique = uniqueField ? this.storage.makeUniqueFieldManager(uniqueField) : null;
    }

    /**
     * prepare default-model when creation
     * @param $def  base-model
     * @abstract
     */
    protected abstract prepareDefault($def: T): T;

    /**
     * hello of this service-identity
     */
    public hello = () => `${this.type}/${this.storage.hello()}`;

    /**
     * default implementation of preparing model
     *  - prepare model w/ safe creation
     * @param id        model-id to prepare
     * @param $def      default model value
     * @param isCreate  (optional) flag to throw if 404
     */
    public async prepare(id: string, $def?: T, isCreate = true): Promise<T> {
        _inf(NS, `prepare(${id})...`);
        _log(NS, `> $def =`, $U.json($def));
        _log(NS, `> isCreate =`, isCreate);
        if (!id) throw new Error(`404 NOT FOUND - id is not valid!`);

        // if 'isCreate' flag is set, read existing model or create initial model by calling abstract method
        if (isCreate) return this.storage.readOrCreate(id, this.prepareDefault($def));
        // this can throw 404
        return this.storage.read(id);
    }

    /**
     * default implementation of creating model
     *  - create message model w/ parent relationship.
     * @param model initial model object
     */
    public async insert(model: T): Promise<T> {
        _inf(NS, `insert...`);
        if (!model) throw new Error(`@model (${this.type}-model) is required!`);
        if (model.id) throw new Error('.id is not valid!');

        const $def = this.prepareDefault(null);
        const created = await this.storage.insert($def);
        const id = `${(created && created.id) || ''}`;
        if (!id) throw new Error('.id (string) is required - insert() fail!');
        _log(NS, `> model.base =`, $U.json(model));

        const $saves = { ...model }; // clone
        delete $saves.id; // clear id
        const saved = await this.storage.save(id, $saves);
        _log(NS, `> model.saved =`, $U.json(saved));

        return { ...created, ...saved, id };
    }

    /**
     * default implementation of retrieving model
     * @param id    model id
     */
    public async retrieve(id: string): Promise<T> {
        _inf(NS, `retrieve(${id})...`);
        if (!id) throw new Error(`@id is required!`);

        return this.storage.read(id).catch(e => {
            if (`${e.message}`.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - ${this.type}:${id}`);
            throw e;
        });
    }

    /**
     * default implementation of updating model
     * @param id    model id
     * @param model model object
     * @param $inc  incremental set
     */
    public async update(id: string, model: T, $inc?: T): Promise<T> {
        _inf(NS, `update(${id})...`);
        if (!id) throw new Error(`@id is required!`);
        if (!model) throw new Error(`@model (${model.type}) is required!`);

        const $org = await this.retrieve(id);
        _log(NS, `> model.org =`, $U.json(model));
        const $ups = this.onBeforeSave({ ...model }, $org);
        const updated = Object.keys($ups).length ? await this.storage.update(id, $ups, { ...$inc }) : {};
        _log(NS, `> model.updated =`, $U.json(updated));

        return { ...$org, ...updated, id };
    }

    /**
     * default implementation of upserting model
     * @param id    model id
     * @param model model object
     */
    public async updateOrCreate(id: string, model: T): Promise<T> {
        _inf(NS, `updateOrCreate(${id})...`);
        if (!id) throw new Error(`@id is required!`);
        if (!model) throw new Error(`@model (${model.type}) is required!`);

        const $org = await this.prepare(id, null, true);
        const $ups = this.onBeforeSave({ ...model }, $org);
        const updated = Object.keys($ups).length ? await this.storage.update(id, $ups) : {};
        _log(NS, `> model.updated =`, $U.json(updated));

        return { ...$org, ...updated, id };
    }

    /**
     * default implementation of deleting model
     * @param id
     * @param destroy
     */
    public async delete(id: string, destroy: boolean = true): Promise<T> {
        _inf(NS, `delete(${id})...`);
        if (!id) throw new Error(`@id is required!`);

        const $org = await this.retrieve(id);
        const deleted = await this.storage.delete(id, destroy);
        _log(NS, `> model.deleted =`, $U.json(deleted));

        return { ...$org, id };
    }

    /**
     * callback invoked just before model is saved
     *  - override this to customize behavior
     * @param model
     * @param origin
     */
    public onBeforeSave(model: T, origin?: T): T {
        return super.onBeforeSave(model, origin);
    }
}
