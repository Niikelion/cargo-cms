import knex from "knex";
import {Schema} from "../schema/types";

export const getTableName = (schema: Schema) => schema.name.replace(".", "_")

export const constructTable = async (db: knex.Knex, schema: Schema) => {
    const tableName = getTableName(schema)

    const exists = await db.schema.hasTable(tableName)
    const columns = new Set<string>()

    if (exists) {
        const c = await db(tableName).columnInfo().then(c => c)
        for (const column in c)
            columns.add(column)
    }

    const usedNames = new Set<string>()

    const existed = (field: string) => columns.has(field)
    const useName = (field: string) => {
        if (usedNames.has(field))
            return false

        usedNames.add(field)
        return true
    }

    const builder = (creator: knex.Knex.CreateTableBuilder) => {
        if (!exists)
            creator.increments('id')

        for (const field of schema.fields) {
            field.type.generateField(Object.assign(creator, { existed, useName }), field.name, field.constraints)
        }
        const columnsToRemove = [...columns].filter(column => !usedNames.has(column))
        creator.dropColumns(...columnsToRemove)
    }

    if (exists)
        await db.schema.alterTable(tableName, builder).then()
    else
        await db.schema.createTable(tableName, builder).then()
}