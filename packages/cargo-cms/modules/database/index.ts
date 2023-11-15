import {makeModule} from "@cargo-cms/modules-core";
import knex from "knex"
import {FilterType, Schema, SelectorStructure} from "@cargo-cms/database/schema";
import {queryByStructure, QueryByStructureAdditionalArgs} from "@cargo-cms/database/query"
import {constructTable, constructTables} from "./table";
import {generateStructure, getTableName} from "@cargo-cms/database/schema/utils"
import {getConfig} from "./config";
import {removeWithFilter} from "@cargo-cms/database/remove";

const err = () => {
    throw new Error("Database not initialized")
}

const data = {
    raw: null as knex.Knex | null,
    async setup(configPath: string): Promise<void> {
        const config = await getConfig(configPath)
        data.raw = knex(config ?? {})
    },
    async constructTables(schemas: Schema[]): Promise<void> {
        if (data.raw === null)
            return err()
        await constructTables(data.raw, schemas)
    },
    async constructTable(schema: Schema): Promise<void> {
        if (data.raw === null)
            return err()
        await constructTable(data.raw, schema)
    },
    async query(schema: Schema, selector: SelectorStructure, args?: Omit<QueryByStructureAdditionalArgs, "query">) {
        if (data.raw === null)
            return err()
        return await queryByStructure(data.raw, generateStructure(schema, selector), getTableName(schema), args)
    },
    async remove(schema: Schema, selector: SelectorStructure, filter: FilterType) {
        if (data.raw === null)
            return err()
        return await removeWithFilter(data.raw, generateStructure(schema, selector), getTableName(schema), filter)
    },
    async finish(): Promise<void> {
        if (data.raw === null)
            return err()
        await data.raw.destroy()
    }
}

const databaseModule = makeModule("database", {}, data)

export type Database = typeof data
export type DatabaseModule = typeof databaseModule
export default databaseModule