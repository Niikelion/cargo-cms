import {makeModule, ModuleContext} from "@cargo-cms/module-core";
import knex from "knex"
import {Schema, SelectorStructure} from "@cargo-cms/database/schema";
import {fetchByStructure, FetchByStructureAdditionalArgs} from "@cargo-cms/database/query"
import {constructTable, constructTables} from "./table";
import {generateStructure, getTableName} from "@cargo-cms/database/schema/utils"
import {getConfig} from "./config";

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
    async query(schema: Schema, selector: SelectorStructure, args?: Omit<FetchByStructureAdditionalArgs, "query">) {
        if (data.raw === null)
            return err()
        return await fetchByStructure(data.raw, generateStructure(schema, selector), getTableName(schema), args)
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