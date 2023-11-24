import {ModuleContext} from "@cargo-cms/modules-core";
import {TypeRegistryModule} from "../type-registry";
import {DatabaseModule} from "../database";
import {FilterType} from "@cargo-cms/database/schema";
import {RestApiError} from "../http-server/utils";
import {generateSelectorFromFilter} from "@cargo-cms/database/utils";

export const makeDelete = async (ctx: ModuleContext) => {
    const [ typeRegistry, database ] = await ctx.requireMany<[TypeRegistryModule, DatabaseModule]>("type-registry", "database")

    return async (typeName: string, filter: FilterType) => {
        const type = typeRegistry.getEntityType(typeName)

        if (type === null)
            throw new RestApiError(`Entity type ${typeName} not found`, 404)

        return await database.remove(type, generateSelectorFromFilter(filter), filter)
    }
}