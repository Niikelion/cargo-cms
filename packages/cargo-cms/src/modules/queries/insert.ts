import {ModuleContext} from "@cargo-cms/modules-core";
import {TypeRegistryModule} from "../type-registry";
import {DatabaseModule} from "../database";
import {JSONValue} from "@cargo-cms/utils";
import {RestApiError} from "../http-server/utils";

export const makeInsert = async (ctx: ModuleContext) => {
    const [ typeRegistry, database ] = await ctx.requireMany<[TypeRegistryModule, DatabaseModule]>("type-registry", "database")

    return async (typeName: string, value: JSONValue) => {
        const type = typeRegistry.getEntityType(typeName)

        if (type === null)
            throw new RestApiError(`Entity type ${typeName} not found`, 404)

        return await database.insert(type, value)
    }
}