import {JSONValue} from "@cargo-cms/utils/types";
import {getEntityType} from "../schema";
import {RestApiError} from "../server/utils";
import {SelectorStructure} from "@cargo-cms/database/schema";
import {DataBase} from "../database/init";

//TODO: filtering, ordering and stuff like that
export const getEntities = async (db: DataBase, typeName: string, selector: SelectorStructure): Promise<JSONValue[]> => {
    const type = getEntityType(typeName)

    if (type === null)
        throw new RestApiError(`Entity type ${typeName} not found`, 404)

    return await db.query(type, selector)
}