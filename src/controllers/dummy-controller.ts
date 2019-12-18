/**
 * API: `/dummy-controller`
 * - public service api w/ dummy data
 * - use `data/dummy.file.yml` to serve CRUD operation
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-10 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
/** ********************************************************************************************************************
 *  Common Headers
 ** ********************************************************************************************************************/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, $_ } from '../engine/';
import { NextHandler, NextMode } from '../cores/core-types';
import { DummyDynamoService } from '../cores/dynamo-service';
import { GeneralController } from './general-controller';

/** ********************************************************************************************************************
 *  MAIN IMPLEMENTATION.
 ** ********************************************************************************************************************/
/**
 * class: `DummyController`
 * - to serve basic CRUD with `dummy-<type>-data.yml`
 */
export class DummyController extends GeneralController {
    protected _name: string;
    protected service: DummyDynamoService<any>;

    /**
     * create dummy-controller with type
     *
     * @param type      type of resource
     * @param name      name of dummy data (default equal to type)
     * @param idName    name of id (default as 'id')
     */
    public constructor(type: string, name?: string, idName: string = 'id') {
        super(type);
        this._name = name || type;
        //! prepare dynamo options.
        const tableName = `dummy-${this._name}`;
        const fileName = `dummy-${this._name}-data.yml`;
        this.service = new DummyDynamoService(fileName, { tableName, idName });
    }

    /**
     * name of this resource.
     */
    public hello = () => `dummy-controller:${this.type()}/${this._name}`;

    /**
     * decode to target `next-handler`
     * - use pattern `do_<mode>_<cmd?>`
     */
    public decode(mode: NextMode, id: string, cmd: string) {
        //WARN - if like to use `super.` in here. must use function style.
        const fx = super.decode(mode, id, cmd);
        if (fx) return fx;

        //! decode as `do_<mode>_<cmd?>` style.
        const funcName = (cmd ? `do_${mode}_${cmd}` : `do_${mode}`).toLowerCase();
        const handler = (this as any)[funcName];
        return typeof handler == 'function' ? handler : null;
    }

    /**
     * get list of data.
     */
    public do_list: NextHandler = async (id, param, body, ctx) => {
        param = param || {};
        const page = $U.N(param.page, 1);
        const limit = $U.N(param.limit, 1);
        return this.service.listItems(page, limit);
    };

    /**
     * read item.
     */
    public do_get: NextHandler = async (id, param, body, ctx) => {
        return this.service.readItem(id);
    };

    /**
     * update item.
     */
    public do_put: NextHandler = async (id, param, body, ctx) => {
        return this.service.updateItem(id, null, body);
    };

    /**
     * save item.
     */
    public do_post: NextHandler = async (id, param, body, ctx) => {
        return this.service.saveItem(id, body);
    };

    /**
     * delete item.
     */
    public do_delete: NextHandler = async (id, param, body, ctx) => {
        return this.service.deleteItem(id);
    };
}
