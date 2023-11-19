import knex from "knex";
import schemaInspector from 'knex-schema-inspector';
import {Schema} from "@cargo-cms/database/schema";
import {build, Field, Table} from "@cargo-cms/database";
import {isDefined} from "@cargo-cms/utils/filters";
import {getTableName} from "@cargo-cms/database/schema/utils"

export const constructTables = async (db: knex.Knex, schemas: Schema[]) => {
    const oldTables = await schemaInspector(db).tables()

    const tables = await Promise.all(schemas.map(schema => constructTable(db, schema)))

    const tableNames = tables.flat().map(table => table.name)
    const newTables = new Set<string>(tableNames)

    for (const table of oldTables) {
        if (newTables.has(table))
            continue

        await db.schema.dropTable(table).then()
    }
}

export const constructTable = async (db: knex.Knex, schema: Schema) => {
    const name = getTableName(schema)

    const table = build.table(name)

    const tables = schema.fields.map(field => field.type.generateColumns(table, field.name, field.constraints)).filter(isDefined).flat()

    await rawConstructTable(db,table)
    await Promise.all(tables.map(table => rawConstructTable(db, table)))

    return [ table, ...tables ]
}

export const rawConstructTable = async (db: knex.Knex, table: Table<never>) => {
    const tableName = table.name

    const ds = db.schema

    const exists = await ds.hasTable(tableName)
    const prevColumns = new Set<string>()
    const prevUniques = new Set<string>()

    if (exists) {
        const inspector = schemaInspector(db)

        const c = await inspector.columnInfo(tableName)
        for (const column of c) {
            const col = column.name
            prevColumns.add(col)
            if (column.is_unique)
                prevUniques.add(col)
        }
    }

    const builder = (creator: knex.Knex.CreateTableBuilder) => {
        creator.dropForeign([...prevColumns])

        if (!exists)
            creator.increments("_id")

        table.apply(creator, exists, prevColumns)
        const usedNames = new Set<string>(Object.keys(table.fields))
        usedNames.add("_id")

        const columnsToRemove = [...prevColumns].filter(column => !usedNames.has(column))

        if (columnsToRemove.length > 0)
            creator.dropColumns(...columnsToRemove);

        Object.entries<Field>(table.fields).forEach(([n, field]) => {
            if (!field.isUnique && prevUniques.has(n))
                creator.dropUnique([n])
        })
    }

    if (exists)
        await db.schema.alterTable(tableName, builder).then()
    else
        await db.schema.createTable(tableName, builder).then()
}