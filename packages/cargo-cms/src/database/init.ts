import knex from "knex"
import * as fs from "fs/promises";
import * as path from "path";
import {FilterType, OrderType, Schema, SelectorStructure} from "@cargo-cms/database/schema";
import {fetchByStructure} from "@cargo-cms/database/query"
import {constructTable, constructTables} from "./table";
import {isBool, isNumber} from "@cargo-cms/utils/filters";
import {JSONValue} from "@cargo-cms/utils/types";
import {generateStructure, getTableName} from "@cargo-cms/database/schema/utils"

const getVar = (variableName: string, defaultValue: unknown) => {
    return process.env[variableName] ?? defaultValue
}

const withValidator = <T>(validator: (v: unknown) => v is T) => (variableName: string, defaultValue: T) => {
    const v = getVar(variableName, defaultValue)

    return validator(v) ? v : defaultValue
}

const env = Object.assign(getVar, {
    bool: withValidator(isBool),
    int: withValidator(isNumber),
})

const getConfig = async (configPath: string): Promise<knex.Knex.Config | null> => {
    try {
        const stat = await fs.stat(configPath)

        if (!stat.isFile() || path.extname(configPath) !== ".js")
            return null

        const configCreator = (await import(`file://${configPath}`)).default

        const config = configCreator({env})

        return config as knex.Knex.Config
    } catch (err) {
        console.log(`Couldn't load database config ${configPath}`)
        console.error(err)
        return null
    }
}

export type DataBase = {
    raw: knex.Knex
    constructTables: (schemas: Schema[]) => Promise<void>
    constructTable: (schema: Schema) => Promise<void>
    query: (schema: Schema, selector: SelectorStructure, args?: {
        filter?: FilterType,
        order?: OrderType[]
    }) => Promise<JSONValue[]>
    finish: () => Promise<void>
}

export const createDatabase = async (configPath: string) => {
    const config = await getConfig(configPath)

    const db = knex(config ?? {})

    return {
        raw: db,
        async constructTables(schemas: Schema[]) {
            await constructTables(db, schemas)
        },
        async constructTable(schema: Schema) {
            await constructTable(db, schema)
        },
        async query(schema: Schema, selector: SelectorStructure, args) {
            return await fetchByStructure(db, generateStructure(schema, selector), getTableName(schema), args)
        },
        async finish() {
            await db.destroy()
        }
    } satisfies DataBase
}