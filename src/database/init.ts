import knex from "knex"
import * as fs from "fs/promises";
import path from "path";
import {Schema} from "../schema/types";
import {constructTable} from "./table";
import {isBool, isNumber} from "../utils/filters";

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

export const createDatabase = async (configPath: string) => {
    const config = await getConfig(configPath)

    const db = knex(config ?? {})

    return {
        async constructTable(schema: Schema) {
            await constructTable(db, schema)
        },
        async finish() {
            await db.destroy()
        }
    }
}