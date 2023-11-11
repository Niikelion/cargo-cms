import {JSONValue} from "@cargo-cms/utils/types";
import {getEntityType} from "../schema";
import {RestApiError} from "../server/utils";
import {FilterType, SelectorStructure} from "@cargo-cms/database/schema";
import {DataBase} from "../database/init";

//TODO: ordering
export const getEntities = async (db: DataBase, typeName: string, selector: SelectorStructure, args?: { filter?: FilterType }): Promise<JSONValue[]> => {
    const type = getEntityType(typeName)

    const { filter } = args ?? {}

    if (type === null)
        throw new RestApiError(`Entity type ${typeName} not found`, 404)

    return await db.query(type, selector, { filter })
}