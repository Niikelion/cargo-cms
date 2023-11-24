import {makeModule} from "@cargo-cms/modules-core";
import knex from "knex"
import {FilterType, Schema, SelectorStructure} from "@cargo-cms/database/schema";
import {queryByStructure, QueryByStructureAdditionalArgs} from "@cargo-cms/database/query"
import {constructTable, constructTables} from "./table";
import {generateStructure, getTableName} from "@cargo-cms/database/schema/utils"
import {getConfig} from "./config";
import {removeWithFilter} from "@cargo-cms/database/remove";
import {isString, JSONValue} from "@cargo-cms/utils";
import {insert} from "@cargo-cms/database/insert";
import {DebugModule} from "../debug";

const err = () => {
    throw new Error("Database not initialized")
}

let logSql: ((sql: string) => void) | undefined = undefined

const data = {
    raw: null as knex.Knex | null,
    async setup(configPath: string): Promise<void> {
        const config = await getConfig(configPath)

        const db = knex(config ?? {})
        const client = config?.client
        const isSqlite = client !== undefined && (client === "sqlite" || (!isString(client) && client.name === "sqlite"))

        if (isSqlite)
            await db.raw("PRAGMA foreign_keys = ON").then()

        data.raw = db
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
        return await queryByStructure(data.raw, generateStructure(schema, selector), getTableName(schema), {...args, logSql})
    },
    async remove(schema: Schema, selector: SelectorStructure, filter: FilterType) {
        if (data.raw === null)
            return err()
        return await removeWithFilter(data.raw, generateStructure(schema, selector), getTableName(schema), filter, logSql)
    },
    async insert(schema: Schema, value: JSONValue) {
        if (data.raw === null)
            return err()
        return await insert(data.raw, generateStructure(schema, "**"), getTableName(schema), value, logSql)
    },
    async finish(): Promise<void> {
        if (data.raw === null)
            return err()
        await data.raw.destroy()
    }
}

const databaseModule = makeModule("database", {
    async init(ctx) {
        const debug = await ctx.require<DebugModule>("debug")
        logSql = debug?.channel("sql")?.log
    }
}, data)

export type DatabaseModule = typeof databaseModule
export default databaseModule