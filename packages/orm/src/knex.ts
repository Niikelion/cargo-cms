import {
    ArraySchema, DatabaseDriver, DataSchema, Diff, GenericProperties, ObjectSchema,
    PrimitiveFieldSchema, QueryOptions, RelationFieldSchema, ResponseSelector, TypeSchema, TypesSchema
} from "./types";
import knex, {Knex} from "knex";
import md5 from "md5"
import * as assert from "assert";
import {applyDiffToTypeSchema} from "./utils";

export type TableField = (PrimitiveFieldSchema | ({
    type: "link",
    target: string
} & GenericProperties))

type TableSchema = {
    name: string
    schemaName?: string
    fields: Record<string, TableField>
}

type EnrichmentData = {
    fieldName: string
    tableName: string
}

type EnrichedFieldSchema = EnrichmentData & (PrimitiveFieldSchema | RelationFieldSchema)
type EnrichedArraySchema = Pick<EnrichmentData, "tableName"> & Omit<ArraySchema, "elements"> & { elements: EnrichedDataSchema }
type EnrichedObjectSchema = Pick<EnrichmentData, "tableName"> & Omit<ObjectSchema, "fields"> & { fields: Record<string, EnrichedDataSchema> }
type EnrichedDataSchema = EnrichedFieldSchema | EnrichedArraySchema | EnrichedObjectSchema
type EnrichedTypeSchema = Pick<EnrichmentData, "tableName"> & Omit<TypeSchema, "fields"> & { fields: Record<string, EnrichedDataSchema> }
type EnrichedTypesSchema = Record<string, EnrichedTypeSchema>

const extendPath = (path: string, extension: string): string => path.length > 0 ? `${path}.${extension}` : extension

/**
 * Creates unique output for every string that is a proper table name.
 * @param tableName
 */
const escape = (tableName: string): string => tableName.replace(/_/, "__")

const escapePath = (field: string): string => escape(field.split('.').map(escape).join('_'))

type TableCreationConfig = {
    mangleTableNames?: boolean
    mangleFieldNames?: boolean
}

type FlattenedSchema = {
    enrichedSchema: EnrichedDataSchema
    fields: Record<string, TableField>,
    additionalTables: Record<string, TableSchema>
}

const makeTableNameCreator = (config: TableCreationConfig) => {
    const makeTableName = (tableType: string, name: string): string => {
        const rawName = `${tableType}_${escape(name)}`

        if (!config.mangleTableNames) return rawName

        return `t_${md5(rawName).substring(0, 16)}`
    }

    return Object.assign(makeTableName, {
        link: (source: string, path: string, target: string) =>
            makeTableName("link", `${escape(source)}_${escapePath(path)}_${escape(target)}`),
        item: (source: string, path: string) =>
            makeTableName("item", `${escape(source)}_${escapePath(path)}`),
        entity: (name: string) =>
            makeTableName("entity", name),
        relation: (first: string, second: string) =>
            makeTableName("relation", `${escape(first)}_${escape(second)}`)
    })
}

const makeFieldNameCreator = (config: TableCreationConfig) => {
    return (path: string): string => {
        const rawName = escapePath(path)
        if (!config.mangleFieldNames) return rawName
        return `f_${md5(rawName).substring(0, 16)}`
    }
}

function flattenSchema(sourceTableName: string, path: string, schema: DataSchema, config: TableCreationConfig): FlattenedSchema {
    const additionalTables: Record<string, TableSchema> = {}

    const assertFreshTable = (tableName: string) => {
        if (tableName in additionalTables) throw new Error(`Duplicate table ${tableName}`)
    }

    const fields: Record<string, TableField> = {}

    const makeTableName = makeTableNameCreator(config)
    const makeFieldName = makeFieldNameCreator(config)

    const fieldNameByPath = makeFieldName(path)

    let enrichedSchema: FlattenedSchema["enrichedSchema"] | null = null

    switch (schema.type) {
        case "object": {
            const enrichedFields: EnrichedObjectSchema["fields"] = {}

            for (const fieldName in schema.fields) {
                const field = schema.fields[fieldName]
                const {
                    fields: recursiveFields,
                    additionalTables: recursiveAdditionalTables,
                    enrichedSchema: enrichedFieldSchema
                } = flattenSchema(sourceTableName, extendPath(path, fieldName), field, config)

                Object.entries(recursiveFields).forEach(([key, value]) => {
                    if (key in fields)
                        throw new Error(`Duplicate field ${key}`)
                    fields[key] = value;
                })
                Object.entries(recursiveAdditionalTables).forEach(([key, value]) => {
                    assertFreshTable(key)
                    additionalTables[key] = value
                })
                enrichedFields[fieldName] = enrichedFieldSchema
            }

            enrichedSchema = { ...schema, tableName: sourceTableName, fields: enrichedFields }
            break
        }
        case "array": {
            const arrayTableName = makeTableName.item(sourceTableName, path)
            const linkTableName = makeTableName.link(sourceTableName, path, arrayTableName)

            assertFreshTable(linkTableName)
            assertFreshTable(arrayTableName)

            const {
                fields: arrayFields,
                additionalTables: arrayAdditionalTables,
                enrichedSchema: enrichedElementsSchema
            } = flattenSchema(arrayTableName, "", schema.elements, config)

            additionalTables[linkTableName] = {
                name: linkTableName,
                fields: {
                    parentId: { type: "link", target: sourceTableName },
                    elementId: { type: "link", target: arrayTableName }
                }
            }

            additionalTables[arrayTableName] = {
                name: arrayTableName,
                fields: arrayFields
            }

            Object.entries(arrayAdditionalTables).forEach(([key, value]) => {
                assertFreshTable(key)
                additionalTables[key] = value
            })

            enrichedSchema = { ...schema, elements: enrichedElementsSchema, tableName: arrayTableName }
            break
        }
        case "relation": {
            const target = makeTableName.entity(schema.target)

            // skip when bidirectional relation link table is created by other end of relation
            // that is, when other side is multiple, and either this side is not, or it is but target table name is lexicographically smaller
            if (schema.bidirectional && schema.targetField.multiple && (!schema.multiple || target < sourceTableName)) break

            if (schema.multiple) {
                const getFieldsAndTableName = () => {
                    if (!schema.bidirectional) return [ makeTableName.link(sourceTableName, path, target), "parentId", "targetId" ]

                    if (schema.targetField.multiple) return [ makeTableName.relation(sourceTableName, target), `${sourceTableName}_id`, `${target}_id` ]

                    return [ makeTableName.link(target, schema.targetField.path, sourceTableName), "targetId", "parentId" ]
                }

                const [linkTableName, sourceField, targetField] = getFieldsAndTableName()

                assertFreshTable(linkTableName)

                additionalTables[linkTableName] = {
                    name: linkTableName,
                    fields: {
                        [sourceField]: { type: "link", target: sourceTableName },
                        [targetField]: { type: "link", target }
                    }
                }

                enrichedSchema = {...schema, fieldName: sourceField, tableName: linkTableName}
                break
            }

            fields[fieldNameByPath] = { type: "link", target }
            enrichedSchema = { ...schema, fieldName: fieldNameByPath, tableName: target }
            break
        }
        default: {
            fields[fieldNameByPath] = { ...schema }
            enrichedSchema = { ...schema, fieldName: fieldNameByPath, tableName: sourceTableName }
            break
        }
    }

    assert.ok(enrichedSchema !== null)

    return { fields, additionalTables, enrichedSchema }
}

const combineTableDefinitions = (definitions: Record<string, TableSchema>[]): Record<string, TableSchema> => {
    const combined: Record<string, TableSchema> = {}

    definitions.forEach(definition => {
        Object.entries(definition).forEach(([key, value]) => {
            if (key in combined) throw new Error(`Duplicate field ${key}`)
            combined[key] = value
        })
    })

    return combined
}

function processTypeSchema(schema: TypeSchema, config: TableCreationConfig): { tables: Record<string, TableSchema>, enrichedSchema: EnrichedTypeSchema} {
    const makeTableName = makeTableNameCreator(config)
    const tableName = makeTableName.entity(schema.name)
    const { fields, additionalTables: tables, enrichedSchema: enrichedDataSchema } = flattenSchema(tableName,"", schema, config)

    const table = { name: tableName, fields, schemaName: schema.name } satisfies TableSchema

    if (table.name in tables)
        throw new Error(`Duplicate table ${table.name}`)

    tables[table.name] = table

    assert.ok(enrichedDataSchema.type === "object")

    const enrichedSchema: EnrichedTypeSchema = { ...enrichedDataSchema, name: schema.name, tableName: table.name }
    return { tables, enrichedSchema }
}

const makeLinkConstraintName = (fieldName: string) => `${fieldName}_link`
const makeUniqueConstraintName = (fieldName: string) => `${fieldName}_unique`

type AdditionalConfig = Pick<TableCreationConfig, "mangleTableNames" | "mangleFieldNames">
type KnexDriverConfig = Knex.Config & AdditionalConfig

const schemaTable = "cargo_schema"

export class KnexDriver implements DatabaseDriver {
    private db: Knex | null
    private readonly config: KnexDriverConfig
    private currentSchema: Record<string, TypeSchema>
    private currentTableSchema: Record<string, TableSchema>
    private enrichedSchema: EnrichedTypesSchema

    constructor(config: KnexDriverConfig) {
        this.db = null
        this.config = config

        this.currentSchema = {}
        this.currentTableSchema = {}
        this.enrichedSchema = {}
    }

    async init(): Promise<void> {
        this.db = knex(this.config)

        const hasTable = await this.db.schema.hasTable(schemaTable)

        if (!hasTable) {
            await this.db.schema.createTable(schemaTable, table => {
                table.string("version").unique()
                table.json("types")
            })
            await this.db(schemaTable).insert({ version: "current", types: JSON.stringify(this.currentSchema) })
            return
        }

        const [result] = await this.db(schemaTable).select("types").where({ version: "current" })
        if (!result)
            throw new Error("Instance without a schema")

        const { types: rawTypes } = result

        const types: TypesSchema = JSON.parse(rawTypes)

        this.setSchema(types)
    }

    private generateInternalsForSchema(types: TypesSchema): { tableSchema: Record<string, TableSchema>, enrichedSchema: EnrichedTypesSchema } {
        const enrichedSchema: EnrichedTypesSchema = {}

        const processedSchemas = Object.values(types).map(t => processTypeSchema(t, this.config))

        const tableSchema = combineTableDefinitions(processedSchemas.map(s => s.tables))
        processedSchemas.forEach(s => enrichedSchema[s.enrichedSchema.name] = s.enrichedSchema)

        this.enrichedSchema = enrichedSchema
        return { tableSchema, enrichedSchema }
    }

    private setSchema(types: TypesSchema) {
        this.currentSchema = types

        const { enrichedSchema, tableSchema } = this.generateInternalsForSchema(types)

        this.enrichedSchema = enrichedSchema
        this.currentTableSchema = tableSchema
    }

    async close(): Promise<void> {
        if (!this.db) return

        await this.db.destroy()
        this.db = null
    }

    private async modifyTable(tableName: string, callback: (tableSchema: TableSchema, builder: Knex.AlterTableBuilder) => void | Promise<void>): Promise<void> {
        assert.ok(this.db !== null)

        const tableExists = tableName in this.currentTableSchema

        if (!tableExists) return

        const tableSchema = this.currentTableSchema[tableName]

        const builderCallback = (builder: Knex.AlterTableBuilder) => callback(tableSchema, builder)

        await this.db.schema.alterTable(tableName, builderCallback)
    }

    private async dropConstraintsForTable(tableName: string): Promise<void> {
        await this.modifyTable(tableName, async (tableSchema, builder) => {
            const fields = Object.entries(tableSchema.fields)

            const links = fields.filter(([_, value]) => value.type === "link")
            links.forEach(([name]) => builder.dropForeign(makeLinkConstraintName(name)))

            const uniques = fields.filter(([_, value]) => value.unique)
            uniques.forEach(([name]) => builder.dropUnique([name], makeUniqueConstraintName(name)))
        })
    }

    private async applyConstraintsForSchema(tableName: string): Promise<void> {
        await this.modifyTable(tableName, async (tableSchema, builder) => {
            const fields = Object.entries(tableSchema.fields)

            const links = fields.filter((e): e is [string, TableField & { type: "link" }] => e[1].type === "link")
            links.forEach(([name, value]) => builder.foreign(name, makeLinkConstraintName(name)).references("id").inTable(value.target))

            const uniques = fields.filter(([_, value]) => value.unique)
            uniques.forEach(([name]) => builder.unique([name], {
                indexName: makeUniqueConstraintName(name)
            }))
        })
    }

    private async applySchemaForTable(tableSchema: TableSchema): Promise<void> {
        assert.ok(this.db !== null)

        const exists = tableSchema.name in this.currentSchema

        const tableCallback = (builder: Knex.CreateTableBuilder) => {
            if (!exists)
                builder.increments("id")

            for (const [key, value] of Object.entries(tableSchema.fields)) {
                const makeColumn = (): Knex.ColumnBuilder => {
                    switch (value.type) {
                        case "text":
                        case "string": return builder.string(key)
                        case "boolean": return builder.boolean(key)
                        case "link":
                        case "integer": return builder.integer(key)
                        case "double": return builder.double(key)
                        case "datetime": return builder.datetime(key)
                    }
                }

                let column = makeColumn()

                column = value.nullable ? column.nullable() : column.notNullable()

                if (exists)
                    column.alter()
            }
        }

        await (exists ? this.db.schema.alterTable(tableSchema.name, tableCallback) : this.db.schema.createTable(tableSchema.name, tableCallback))
    }

    async applySchema(types: Record<string, TypeSchema>): Promise<void> {
        const { tableSchema: tables, enrichedSchema } = this.generateInternalsForSchema(types)

        const tableList = Object.values(tables)

        for (const table of Object.values(this.currentTableSchema))
            await this.dropConstraintsForTable(table.name)

        for (const table of tableList)
            await this.applySchemaForTable(table)

        this.currentSchema = types
        this.currentTableSchema = tables
        this.enrichedSchema = enrichedSchema

        for (const table of Object.values(this.currentTableSchema))
            await this.applyConstraintsForSchema(table.name)
    }

    async applySchemaDelta(changes: Diff): Promise<void> {
        const newSchema = applyDiffToTypeSchema(this.currentSchema, changes)

        await this.applySchema(newSchema)
    }

    async performIntegrityCheck() {
        assert.ok(this.db !== null)

        const tables = this.currentTableSchema

        for (const table of Object.values(tables)) {
            const { name, fields } = table
            const hasTable = await this.db.schema.hasTable(name)

            if (!hasTable)
                throw new Error(`Database is missing table ${name}`)

            for (const [key, value] of Object.entries(fields)) {
                const hasColumn = await this.db.schema.hasColumn(name, key)

                if (!hasColumn)
                    throw new Error(`Database is missing column ${key} in table ${name}`)

                //TODO: check field type and constraints
            }
        }
    }

    async getCurrentSchema() {
        return this.currentSchema
    }

    private async queryByStructure(schema: EnrichedDataSchema, options: QueryOptions & { parentId?: number }): Promise<any> {
        assert.ok(this.db !== null)
        const db = this.db

        const { filter, sort, selector, limit, parentId } = options
        //
        // if (filter) throw new Error("Query filtering not implemented")
        // if (sort) throw new Error("Query sorting not implemented")

        type Field = {
            path: string
            field: string
            table: string
        }

        if (schema.type === "array") {
            // no parent id to link array to, return
            if (parentId === undefined) return null
            return []
        }

        if (schema.type === "relation") {
            //TODO: get relation by link table or parent id
            return null
        }

        // at this point only type that should be accessible is an object
        if (schema.type !== "object") return null

        const tableFields: Field[] = []

        const recursiveFieldExtract = (path: string, schema: EnrichedDataSchema, selector: ResponseSelector | undefined) => {
            if (!selector) return
            const pushField = (field: string, table: string) => tableFields.push({path, field, table})

            const select = (field: string): ResponseSelector | undefined => selector === true ? undefined : selector[field]

            switch (schema.type) {
                case "array":
                    return
                case "relation": //TODO: for relations without link table use join
                    return
                case "object":
                    return Object.entries(schema.fields).forEach(([key, field]) =>
                        recursiveFieldExtract(extendPath(path, key), field, select(key)))
                default:
                    return pushField(schema.fieldName, schema.tableName)
            }
        }

        const query = db(schema.tableName).select(tableFields.map(f =>
            db.raw("?? as ??", [`${f.table}.${f.field}`, escapePath(f.path)])))

        if (limit !== undefined) query.limit(limit)

        throw new Error("Query not implemented")
    }

    async query(entityName: string, options: QueryOptions): Promise<any> {
        assert.ok(this.db !== null)

        const entitySchema = this.enrichedSchema[entityName]

        if (!entitySchema) throw new Error(`Entity type ${entityName} does not exist`)

        return await this.queryByStructure(entitySchema, options)
    }
}
