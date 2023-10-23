import knex from "knex";
import {Schema} from "../schema/types";
import {ColumnBuilder, TableBuilder} from "./types";

export const getTableName = (schema: Schema) => schema.name.replace(".", "_")

type SubTable = [string, (builder: TableBuilder) => void]

type Table = {
    name: string
    generate: (builder: TableBuilder) => void
}

export const constructTable = async (db: knex.Knex, schema: Schema) => {
    const name = getTableName(schema)

    return await rawConstructTable(db, {
        name, generate: (builder) => {
            for (const field of schema.fields) {
                field.type.generateField(builder, field.name, field.constraints, name)
            }
        }
    })
}

export const rawConstructTable = async (db: knex.Knex, table: Table) => {
    const tableName = table.name

    const ds = db.schema

    const exists = await ds.hasTable(tableName)
    const columns = new Set<string>()

    if (exists) {
        const c = await db(tableName).columnInfo().then(c => c)
        for (const column in c)
            columns.add(column)
    }

    const usedNames = new Set<string>()
    let additionalTables: SubTable[] = []

    const existed = (field: string) => columns.has(field)
    const useField = (field: string, column?: ColumnBuilder) => {
        if (column && existed(field) && column.alter)
            column.alter()

        if (usedNames.has(field))
            return false

        usedNames.add(field)

        return true
    }
    const additionalTable = (tableName: string, builder: (builder: TableBuilder) => void): void => {
        additionalTables.push([tableName, builder])
    }

    const builderAdditions = { existed, useField, additionalTable }

    const builder = (creator: knex.Knex.CreateTableBuilder) => {
        if (!exists)
            creator.increments('_id')

        table.generate(Object.assign(creator, builderAdditions))

        const columnsToRemove = [...columns].filter(column => !usedNames.has(column))
        if (columnsToRemove.length > 0)
            creator.dropColumns(...columnsToRemove)
    }

    if (exists)
        await db.schema.alterTable(tableName, builder).then()
    else
        await db.schema.createTable(tableName, builder).then()

    for (const table of additionalTables) {
        const [name, generate] = table
        await rawConstructTable(db, { name, generate })
    }
}