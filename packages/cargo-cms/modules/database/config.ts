import {isBool, isNumber} from "@cargo-cms/utils/filters";
import knex from "knex";
import fs from "fs/promises";
import path from "path";

const getVar = (variableName: string, defaultValue: unknown) => process.env[variableName] ?? defaultValue

const withValidator = <T>(validator: (v: unknown) => v is T) => (variableName: string, defaultValue: T) => {
    const v = getVar(variableName, defaultValue)

    return validator(v) ? v : defaultValue
}

const env = Object.assign(getVar, {
    bool: withValidator(isBool),
    int: withValidator(isNumber),
})

export const getConfig = async (configPath: string): Promise<knex.Knex.Config | null> => {
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