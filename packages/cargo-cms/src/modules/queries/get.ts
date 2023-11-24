import {JSONValue} from "@cargo-cms/utils/types";
import {RestApiError} from "../http-server/utils";
import {SelectorStructure} from "@cargo-cms/database/schema";
import {QueryByStructureAdditionalArgs} from "@cargo-cms/database/query";
import {TypeRegistryModule} from "../type-registry";
import {ModuleContext} from "@cargo-cms/modules-core";
import {DatabaseModule} from "../database";

export const makeGet = async (ctx: ModuleContext) => {
    const [ typeRegistry, database ] = await ctx.requireMany<[TypeRegistryModule, DatabaseModule]>("type-registry", "database")

    return async (typeName: string, selector: SelectorStructure, args?: Omit<QueryByStructureAdditionalArgs, "query">): Promise<JSONValue[]> => {
        const type = typeRegistry.getEntityType(typeName)

        if (type === null)
            throw new RestApiError(`Entity type ${typeName} not found`, 404)

        return await database.query(type, selector, args)
    };
}