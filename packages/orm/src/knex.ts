import {
    DatabaseDriver
} from "./types";
import knex, {Knex} from "knex";
import md5 from "md5"
import * as assert from "assert";
import {
    applyDiffToTypeSchema, Diff,
    isArray,
    isBoolean,
    isNumber,
    isObject,
    isCombinedOperationFilter,
    isString,
    Json
} from "./utils";
import {
    ArraySchema,
    DataSchema, FieldType, GenericProperties,
    ObjectSchema, PrimitiveFieldSchema,
    PrimitiveType,
    RelationFieldSchema,
    TypeSchema,
    TypesSchema
} from "./schema";
import {
    DeleteOptions,
    FilterType,
    QueryOptions,
    ResponseSelector,
    SortType,
    UpdateOptions
} from "./operations";
import moment, {ISO_8601} from "moment";
import schemaInspector from 'knex-schema-inspector';
import {ForeignKey} from "knex-schema-inspector/dist/types/foreign-key";
import {Column} from "knex-schema-inspector/dist/types/column";

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

type EnrichedPrimitiveFieldSchema = EnrichmentData & PrimitiveFieldSchema
type EnrichedRelationSchema = (EnrichmentData & { targetFieldName: string } & RelationFieldSchema)
type EnrichedFieldSchema = EnrichedPrimitiveFieldSchema | EnrichedRelationSchema
type EnrichedArraySchema = Pick<EnrichmentData, "tableName"> & Omit<ArraySchema, "elements"> & { elements: EnrichedObjectSchema }
type EnrichedObjectSchema = Pick<EnrichmentData, "tableName"> & Omit<ObjectSchema, "fields"> & { fields: Record<string, EnrichedDataSchema> }
type EnrichedDataSchema = EnrichedFieldSchema | EnrichedArraySchema | EnrichedObjectSchema
type EnrichedTypeSchema = Pick<EnrichmentData, "tableName"> & Omit<TypeSchema, "fields"> & { fields: Record<string, EnrichedDataSchema> }
type EnrichedTypesSchema = Record<string, EnrichedTypeSchema>

const extendPath = (path: string, extension: string): string => path.length > 0 ? `${path}.${extension}` : extension

/**
 * Creates unique output for every string that is a proper table name.
 * @param tableName
 */
const escape = (tableName: string): string => tableName.replace(/_/g, "__")

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

const hashTableName = (name: string): string => md5(name).substring(0, 16)

const makeTableNameCreator = (config: TableCreationConfig) => {
    const makeTableName = (tableType: string, name: string): string => {
        const rawName = `${tableType}_${name}`

        if (!config.mangleTableNames) return rawName

        return `t_${hashTableName(rawName)}`
    }

    return Object.assign(makeTableName, {
        link: (source: string, path: string, target: string) =>
            makeTableName("link", `${escape(source)}_${escapePath(path)}_${escape(target)}`),
        item: (source: string, path: string) =>
            makeTableName("item", `${escape(source)}_${escapePath(path)}`),
        entity: (name: string) =>
            makeTableName("entity", escape(name)),
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

const shouldCreateLinkTable = (schema: RelationFieldSchema, sourceTable: string, targetTable: string): boolean =>
    !schema.bidirectional || targetTable < sourceTable

const getLinkTable = (schema: RelationFieldSchema, sourceTable: string, targetTable: string, path: string, makeTableName: ReturnType<typeof makeTableNameCreator>) => {
    if (!shouldCreateLinkTable(schema, sourceTable, targetTable) && schema.bidirectional)
        return {
            linkTableName: makeTableName.link(targetTable, schema.targetField.path, sourceTable),
            sourceField: `${sourceTable}_id`,
            targetField: `${targetTable}_id`,
        }

    if (!schema.bidirectional) return {
        linkTableName: makeTableName.link(sourceTable, path, targetTable),
        sourceField: "parentId",
        targetField: "targetId"
    }

    return {
        linkTableName: makeTableName.relation(sourceTable, targetTable),
        sourceField: `${sourceTable}_id`,
        targetField: `${targetTable}_id`,
    }
}

const shouldExpectSingleTarget = (schema: RelationFieldSchema): boolean => !schema.multiple

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
                    elementId: { type: "link", target: arrayTableName },
                    order: { type: "integer" }
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

            if (enrichedElementsSchema.type !== "object")
                throw new Error("Only arrays of objects are permitted")

            enrichedSchema = { ...schema, elements: enrichedElementsSchema, tableName: linkTableName }
            break
        }
        case "relation": {
            const targetTableName = makeTableName.entity(schema.target)

            const { linkTableName, sourceField, targetField } = getLinkTable(schema, sourceTableName, targetTableName, path, makeTableName)

            enrichedSchema = {...schema, fieldName: sourceField, targetFieldName: targetField, tableName: linkTableName}

            // skip when no table needs to be created
            if (!shouldCreateLinkTable(schema, sourceTableName, targetTableName))
                break

            assertFreshTable(linkTableName)

            additionalTables[linkTableName] = {
                name: linkTableName,
                fields: {
                    [sourceField]: {type: "link", target: sourceTableName},
                    [targetField]: {type: "link", target: targetTableName}
                }
            }
            break
        }
        default: {
            fields[fieldNameByPath] = { ...schema }
            enrichedSchema = { ...schema, fieldName: fieldNameByPath, tableName: sourceTableName }
            break
        }
    }

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

function descendSelector(selector: ResponseSelector, field: string): ResponseSelector | undefined {
    return selector === true ? undefined : selector[field]
}

function descendJsonObject(source: Json, field: string): { [k: string]: Json } {
    if (!isObject(source)) return {}

    const fieldValue = source[field] ??= {}
    return isObject(fieldValue) ? fieldValue : {};

}

function setByPath(source: Json, path: string, value: Json) {
    const parts = path.split(".")
    if (parts.length === 0) return
    if (!isObject(source)) return

    let root: { [k: string]: Json } = source
    for (let i=0; i<parts.length-1; i++) {
        root = descendJsonObject(root, parts[i])
    }
    root[parts[parts.length - 1]] = value
}

function transformValue(value: PrimitiveType, type: FieldType): PrimitiveType {
    if (value === null)
        return null

    switch (type) {
        case "boolean":
            return Boolean(value)
        case "datetime":
        case "text":
        case "string":
            return value.toString()
        case "integer":
            return isNumber(value) ? Math.trunc(value) : parseInt(value.toString())
        case "float":
            return isNumber(value) ? value : parseFloat(value.toString())
    }
}

function joinTableAlias(sourceTableName: string, targetTableName: string, field: string) {
    return `j_${hashTableName(`${escape(sourceTableName)}_${escape(field)}_${escape(targetTableName)}`)}`
}

function validateDataShape(schema: EnrichedDataSchema, value: Json): boolean {
    switch (schema.type) {
        case "array": {
            if (!isArray(value)) return false

            return value.reduce((acc: boolean, element) => (acc && validateDataShape(schema.elements, element)), true)
        }
        case "object": {
            if (!isObject(value)) return false

            for (const key in schema.fields)
                if (!validateDataShape(schema.fields[key], value[key])) return false

            return true
        }
        case "relation": {
            if (shouldExpectSingleTarget(schema))
                return value === null || isNumber(value)
            return isArray(value) && value.reduce((acc: boolean, v) => acc && isNumber(v), true)
        }
        default: {
            if (schema.nullable && value === null) return true

            switch (schema.type) {
                case "datetime": {
                    if (!isString(value)) return false
                    return moment(value, ISO_8601).isValid()
                }
                case "boolean":
                    return isBoolean(value)
                case "float":
                case "integer":
                    return isNumber(value)
                case "string":
                case "text":
                    return isString(value)
            }
        }
    }
}

function normalizeDatabaseType(type: string): string {
    switch (type) {
        case "double":
            return "float"
        default: return type
    }
}

function getTypeForField(schema: TableField): string {
    switch (schema.type) {
        case "link":
        case "integer":
            return "integer"
        case "text":
            return "text"
        case "datetime":
        case "string":
            return "varchar"
        case "boolean":
            return "boolean"
        case "float":
            return "float"
    }
}

type AdditionalConfig = Pick<TableCreationConfig, "mangleTableNames" | "mangleFieldNames">
type KnexDriverConfig = Knex.Config & AdditionalConfig

const schemaTable = "cargo_schema"

type QueryByStructureOptions = QueryOptions & {
    queryLinker?: (query: Knex.QueryBuilder) => void
}

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

    private getDb(): Knex {
        assert.ok(this.db !== null)
        return this.db
    }
    private getEntitySchema(entityName: string): EnrichedTypeSchema {
        if (!(entityName in this.enrichedSchema)) throw new Error(`Missing entity schema ${entityName}`)

        return this.enrichedSchema[entityName]
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
        const db = this.getDb()

        const tableExists = tableName in this.currentTableSchema

        if (!tableExists) return

        const tableSchema = this.currentTableSchema[tableName]

        const builderCallback = (builder: Knex.AlterTableBuilder) => callback(tableSchema, builder)

        await db.schema.alterTable(tableName, builderCallback)
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
        const db = this.getDb()

        const exists = tableSchema.name in this.currentSchema

        const tableCallback = (builder: Knex.CreateTableBuilder) => {
            if (!exists)
                builder.increments("id")

            for (const [key, value] of Object.entries(tableSchema.fields)) {
                const makeColumn = (): Knex.ColumnBuilder => {
                    switch (value.type) {
                        case "datetime":
                        case "text": return builder.text(key)
                        case "string": return builder.string(key)
                        case "boolean": return builder.boolean(key)
                        case "link":
                        case "integer": return builder.integer(key)
                        case "float": return builder.double(key)
                    }
                }

                let column = makeColumn()

                column = value.nullable ? column.nullable() : column.notNullable()

                if (exists)
                    column.alter()
            }
        }

        await (exists ? db.schema.alterTable(tableSchema.name, tableCallback) : db.schema.createTable(tableSchema.name, tableCallback))
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
        const db = this.getDb()

        const inspector = schemaInspector(db);
        const tables = this.currentTableSchema

        for (const table of Object.values(tables)) {
            const { name, fields } = table

            const hasTable = await inspector.hasTable(name)

            if (!hasTable)
                throw new Error(`Database is missing table ${name}`)

            const rawColumns = await inspector.columnInfo(name)
            const rawForeignKeys = await inspector.foreignKeys(name)

            const columns = new Map<string, Column>()
            rawColumns.forEach(column => columns.set(column.name, column))
            const foreignKeys = new Map<string, ForeignKey>()
            rawForeignKeys.forEach(key => foreignKeys.set(key.column, key))

            for (const [key, value] of Object.entries(fields)) {
                const column = columns.get(key)

                if (column === undefined)
                    throw new Error(`Database is missing column ${key} in table ${name}`)

                if (column.is_nullable !== (value.nullable ?? false))
                    throw new Error(`Expected column ${key} in table ${name} ${value.nullable ? "" : "not"} to be nullable`)

                if (column.is_unique !== (value.unique ?? false))
                    throw new Error(`Expected column ${key} in table ${name} ${value.unique ? "" : "not"} to be unique`)

                const dataType = normalizeDatabaseType(column.data_type)
                const type = getTypeForField(value)

                if (type !== dataType)
                    throw new Error(`Expected column ${key} in table ${name} to have type ${type}, not ${dataType}`)

                const foreignKey = foreignKeys.get(key)

                if (value.type === "link") {
                    if(foreignKey === undefined)
                        throw new Error(`Missing foreign key constraint for column ${key} in table ${name}`)

                    if (foreignKey.foreign_key_table !== value.target)
                        throw new Error(`Expected column ${key} in table ${name} to reference table ${value.target}`)
                } else if (foreignKey !== undefined)
                    throw new Error(`Extra foreign key constraint for column ${key} in table ${name}: ${foreignKeys.get(key)?.constraint_name}`)

                if (value.type !== "datetime" && value.type !== "link" && value.values !== undefined) {
                    const results = await db(name).select("id").whereNotIn(key, value.values)
                    if (results.length > 0)
                        throw new Error(`Some items in column ${key} in table ${name} are outside enum ${JSON.stringify(value.values)}`)
                }
            }
        }
    }

    async getCurrentSchema() {
        return this.currentSchema
    }

    private applyFilter(query: Knex.QueryBuilder, schema: EnrichedObjectSchema, filter: FilterType, joinedTables?: Set<string>): void {
        joinedTables ??= new Set<string>
        type Q = Knex.QueryBuilder
        if (isCombinedOperationFilter(filter)) {
            if ("$not" in filter) return void query.whereNot(q => this.applyFilter(q, schema, filter.$not, joinedTables))
            if ("$and" in filter) return void filter.$and.forEach((c, i) => {
                const innerFilter = (q: Q) => this.applyFilter(q, schema, c, joinedTables)
                if (i === 0) query.where(innerFilter)
                else query.andWhere(innerFilter)
            })
            if ("$or" in filter) return void filter.$or.forEach((c, i) => {
                const innerFilter = (q: Q) => this.applyFilter(q, schema, c, joinedTables)
                if (i === 0) query.where(innerFilter)
                else query.orWhere(innerFilter)
            })
            return
        }

        for (const path in filter) {
            const innerFilter = filter[path]

            const parts = path.split(".")
            let s: EnrichedDataSchema = schema
            let tableName = s.tableName
            for (const part of parts) {
                if (s.type === "array")
                    throw new Error("Cannot filter inside arrays")

                if (s.type === "relation") {
                    if (!shouldExpectSingleTarget(s))
                        throw new Error("Cannot filter inside arrays")

                    const firstAlias = joinTableAlias(tableName, s.tableName, s.fieldName)
                    const targetSchema = this.getEntitySchema(s.target)
                    const secondAlias = joinTableAlias(firstAlias, targetSchema.tableName, s.targetFieldName)
                    if (!joinedTables.has(firstAlias)) {
                        query.innerJoin({[firstAlias]: s.tableName}, `${tableName}.id`, `${firstAlias}.${s.fieldName}`)
                        query.innerJoin({[secondAlias]: targetSchema.tableName}, `${firstAlias}.${s.targetFieldName}`, `${secondAlias}.id`)

                        joinedTables.add(firstAlias)
                        joinedTables.add(secondAlias)
                    }
                    tableName = secondAlias
                    s = targetSchema
                }
                if (s.type !== "object")
                    throw new Error("Incorrect path")

                s = s.fields[part] ?? { type: "integer", fieldName: "id", tableName: s.tableName }
            }

            const currentSchema = {fieldName: "id", ...s, tableName}

            if (currentSchema.type === "array" || currentSchema.type === "relation" || currentSchema.type === "object") continue

            const p = `${currentSchema.tableName}.${currentSchema.fieldName}`

            if ("$eq" in innerFilter) return void query.where(p, `=`, innerFilter.$eq)
            if ("$neq" in innerFilter) return void query.where(p, `<>`, innerFilter.$neq)
            if ("$lt" in innerFilter) return void query.where(p, `<`, innerFilter.$lt)
            if ("$lte" in innerFilter) return void query.where(p, `<=`, innerFilter.$lte)
            if ("$gt" in innerFilter) return void query.where(p, `>`, innerFilter.$gt)
            if ("$gte" in innerFilter) return void query.where(p, `>=`, innerFilter.$gte)
            if ("$like" in innerFilter) return void query.where(p, `like`, innerFilter.$like)
            if ("$null" in innerFilter) return void (innerFilter.$null ? query.whereNull(p) : query.whereNotNull(p))
            if ("$in" in innerFilter) return void query.whereIn(p, innerFilter.$in)
            if ("$between" in innerFilter) return void query.whereBetween(p, innerFilter.$between)

            throw new Error(`Unsupported operation: ${Object.keys(innerFilter).join(", ")}`)
        }
    }
    private applySort(query: Knex.QueryBuilder, schema: EnrichedDataSchema, sort: SortType, joinedTables?: Set<string>) {
        joinedTables ??= new Set<string>()

        if (isString(sort))
            sort = [sort]

        const sortList = sort.map(q => {
            const order = q.endsWith("+") ? true : q.endsWith("-") ? false : null
            const knexOrder = order === true ? "asc" : order === false ? "desc" : undefined
            if (order !== null)
                q = q.substring(0, q.length - 1)

            if (q === "id") {
                return {
                    column: `${schema.tableName}.id`,
                    order: knexOrder
                }
            }

            const parts = q.split('.')

            let currentSchema = schema
            let tableName = currentSchema.tableName

            parts.forEach(part => {
                if (currentSchema.type === "relation") {
                    const targetSchema = this.getEntitySchema(currentSchema.target)

                    const firstAlias = joinTableAlias(tableName, currentSchema.tableName, currentSchema.fieldName)
                    const secondAlias = joinTableAlias(firstAlias, targetSchema.tableName, currentSchema.targetFieldName)

                    if (!joinedTables.has(firstAlias)) {
                        query.innerJoin({[firstAlias]: currentSchema.tableName}, `${tableName}.id`, `${firstAlias}.${currentSchema.fieldName}`)
                        query.innerJoin({[secondAlias]: targetSchema.tableName}, `${firstAlias}.${currentSchema.targetFieldName}`, `${secondAlias}.id`)

                        joinedTables.add(firstAlias)
                        joinedTables.add(secondAlias)
                    }

                    tableName = secondAlias
                    currentSchema = targetSchema
                }
                if (currentSchema.type !== "object") throw new Error("Incorrect path")

                currentSchema = currentSchema.fields[part]
            })

            if (currentSchema.type === "array" || currentSchema.type === "object" || currentSchema.type === "relation")
                throw new Error("Incorrect path")
            return {
                column: `${tableName}.${currentSchema.fieldName}`,
                order: knexOrder
            }
        })

        query.orderBy(sortList)
    }

    private async queryBySchema(schema: EnrichedObjectSchema, options: QueryByStructureOptions): Promise<Json[]> {
        const db = this.getDb()

        const {
            filter,
            sort,
            selector,
            limit,
            offset,
            queryLinker
        } = options

        type Field = {
            path: string
            field: string
            table: string
            type: FieldType
        }
        type ArrayField = {
            path: string
            schema: EnrichedArraySchema
            selector: ResponseSelector
        }
        type RelationField = {
            path: string
            schema: EnrichedRelationSchema
            selector: ResponseSelector
        }
        type Join = {
            sourceTable: string
            sourceField: string
            targetTable: string
            targetField: string
            targetAlias: string
        }

        const tableFields: Field[] = []
        const arrayFields: ArrayField[] = []
        const relationsFields: RelationField[] = []
        const joins: Join[] = []

        const recursiveFieldExtract = (path: string, fieldSchema: EnrichedDataSchema, selector: ResponseSelector | undefined) => {
            if (!selector) return

            switch (fieldSchema.type) {
                case "array":
                    return arrayFields.push({ path, schema: fieldSchema, selector })
                case "relation":
                    if (!shouldExpectSingleTarget(fieldSchema))
                        return relationsFields.push({path, schema: fieldSchema, selector})

                    const firstJoinAlias = joinTableAlias(schema.tableName, fieldSchema.tableName, fieldSchema.fieldName)
                    joins.push({
                        sourceTable: schema.tableName,
                        sourceField: "id",
                        targetTable: fieldSchema.tableName,
                        targetField: fieldSchema.fieldName,
                        targetAlias: firstJoinAlias
                    })
                    const targetSchema = this.getEntitySchema(fieldSchema.target)
                    const secondJoinAlias = joinTableAlias(firstJoinAlias, targetSchema.tableName, fieldSchema.targetFieldName)
                    joins.push({
                        sourceTable: firstJoinAlias,
                        sourceField: fieldSchema.targetFieldName,
                        targetTable: targetSchema.tableName,
                        targetField: "id",
                        targetAlias: secondJoinAlias
                    })

                    return recursiveFieldExtract(path, {...targetSchema, tableName: secondJoinAlias}, selector)
                case "object":
                    return Object.entries(fieldSchema.fields).forEach(([key, field]) =>
                        recursiveFieldExtract(extendPath(path, key), field, descendSelector(selector, key)))
                default:
                    return tableFields.push({ path, field: fieldSchema.fieldName, table: fieldSchema.tableName, type: fieldSchema.type })
            }
        }

        recursiveFieldExtract("", schema, selector)

        const query = db.from(schema.tableName).select(tableFields.map(f =>
            db.raw("?? as ??", [`${f.table}.${f.field}`, escapePath(f.path)]))).select(`${schema.tableName}.id`)

        const joinedTables = new Set<string>()
        for (const join of joins) {
            query.join({[join.targetAlias]: join.targetTable}, `${join.sourceTable}.${join.sourceField}`, `${join.targetAlias}.id`)
            joinedTables.add(join.targetAlias)
        }

        if (limit !== undefined) query.limit(limit)
        if (offset !== undefined) query.offset(offset)
        if (queryLinker !== undefined) queryLinker(query)
        if (filter !== undefined) this.applyFilter(query, schema, filter, joinedTables)
        if (sort !== undefined) this.applySort(query, schema, sort, joinedTables)

        const responses = await query.then<({ id: number } & Record<string, PrimitiveType | null>)[]>()

        const results: Json[] = []

        for (const response of responses) {
            const { id } = response

            const result: Json = { id }

            for (const field of tableFields) {
                const rawValue = response[escapePath(field.path)]
                const value = transformValue(rawValue, field.type)

                setByPath(result, field.path, value)
            }

            // add relation and array fields to the result
            for (const field of arrayFields) {
                const array = await this.queryBySchema(field.schema.elements, {
                    queryLinker: (query) =>
                        query
                            .innerJoin(field.schema.tableName, `${field.schema.tableName}.elementId`, `${field.schema.elements.tableName}.id`)
                            .where(`${field.schema.tableName}.parentId`, `=`, id),
                    selector: field.selector
                }) as ({id: number} & Record<string, Json>)[]

                const values = array.map(({id, ...rest}) => rest)

                setByPath(result, field.path, values)
            }
            for (const field of relationsFields) {
                const singleResult = shouldExpectSingleTarget(field.schema)

                const targetSchema = this.getEntitySchema(field.schema.target)
                const array = await this.queryBySchema(targetSchema, {
                    queryLinker: (query) => query
                        .innerJoin(
                            schema.tableName,
                            `${field.schema.tableName}.${field.schema.targetFieldName}`,
                            `${targetSchema.tableName}.id`)
                        .where(`${field.schema.tableName}.${field.schema.fieldName}`, `=`, id),
                    selector: field.selector
                })

                setByPath(result, field.path, singleResult ? array[0] ?? null : array)
            }

            results.push(result)
        }

        return results
    }
    //TODO: work out how to do transaction
    private async insertBySchema(schema: EnrichedObjectSchema, value: Json): Promise<{id: number}[]> {
        const db = this.getDb()

        assert.ok(isObject(value))

        const obj: Record<string, PrimitiveType | null> = {}
        const arrayFields: { value: Json[], schema: EnrichedArraySchema }[] = []
        const relations: { ids: number[], table: string, sourceField: string, targetField: string }[] = []

        const extractFields = (schema: EnrichedDataSchema, value: Json) => {
            switch (schema.type) {
                case "array":
                    assert.ok(isArray(value))
                    return arrayFields.push({value, schema})
                case "object":
                    assert.ok(value !== null)
                    assert.ok(isObject(value))
                    for (const key in schema.fields) {
                        const field = schema.fields[key]
                        extractFields(field, value[key]);
                    }
                    return
                case "relation":
                    if (!isArray(value)) value = [value]

                    assert.ok(value.every(isNumber))

                    return relations.push({
                        ids: value,
                        table: schema.tableName,
                        sourceField: schema.fieldName,
                        targetField: schema.targetFieldName
                    })
                default:
                    assert.ok(isNumber(value) || isString(value) || isBoolean(value) || value === null)
                    return obj[schema.fieldName] = transformValue(value, schema.type)
            }
        }

        extractFields(schema, value)

        let [id] = await db(schema.tableName).insert(obj).returning("id")
        if (!isNumber(id))
            id = id.id

        for (const field of arrayFields) {
            const {elements} = field.schema

            const elementIds: { id: number }[] = []

            for (const element of field.value) {
                const [r] = await this.insertBySchema(elements, element)
                elementIds.push(r)
            }

            if (elementIds.length === 0) continue

            await db(field.schema.tableName).insert(elementIds.map((e, i) => ({
                parentId: id,
                elementId: e.id,
                order: i
            })))
        }

        for (const relation of relations) {
            if (relation.ids.length === 0) continue

            await db(relation.table).insert(relation.ids.map(linkedId => ({
                [relation.sourceField]: id,
                [relation.targetField]: linkedId
            })))
        }

        return [{id}]
    }
    //TODO: somehow handle transactions
    private async updateBySchema(schema: EnrichedObjectSchema, options: UpdateOptions) {
        const db = this.getDb()

        const { operations, filter } = options
        //TODO: joins can be separate, construct them for sets and perform them in transaction
        const tableSets = new Map<string, {
            tableName: string
            data: Record<string, PrimitiveType>
            join: (query: Knex.QueryBuilder) => void
        }>()

        for (const path in operations) {
            const operation = operations[path]

            const parts = path.split(".")

            let parentPath = ""
            let currentPath = ""
            let currentJoin = (_: Knex.QueryBuilder) => {}
            let lastSchema: EnrichedDataSchema = schema
            let currentSchema: EnrichedDataSchema = schema

            for (const part of parts) {
                const prevSchema = currentSchema
                switch (currentSchema.type) {
                    case "object": {
                        currentSchema = currentSchema.fields[part]
                        assert.ok(currentSchema !== undefined)
                        break
                    }
                    case "array": {
                        const id = parseInt(part)
                        assert.ok(!isNaN(id))
                        const lastJoin = currentJoin

                        const cSchema = currentSchema
                        const lSchema = lastSchema

                        currentJoin = builder => {
                            lastJoin(builder)
                            builder.join(lSchema.tableName, `${lSchema.tableName}.id`, `${cSchema.tableName}.parentId`)
                            builder.join(cSchema.tableName, `${cSchema.tableName}.elementId`, `${cSchema.elements.tableName}.id`)
                            builder.where(`${cSchema.tableName}.order`, `=`, id)
                        }
                        currentSchema = currentSchema.elements
                        break
                    }
                    case "relation": {
                        //TODO: do
                        throw new Error("Unsupported")
                    }
                    default: throw new Error("Cannot update subfield of primitive value")
                }

                currentPath = extendPath(currentPath, part)

                if (currentSchema.type !== "object") {
                    parentPath = currentPath
                }
                lastSchema = prevSchema
            }

            if (currentSchema.type === "object" || currentSchema.type === "array")
                throw new Error("Cannot set object or array")
            if (currentSchema.type === "relation")
                throw new Error("Setting relations not supported yet")

            if ("$set" in operation) {
                if (!tableSets.has(parentPath)) tableSets.set(parentPath, {
                    tableName: currentSchema.tableName,
                    data: {},
                    join: currentJoin
                })

                const table = tableSets.get(parentPath)!
                table.data[currentSchema.fieldName] = operation.$set
            }
        }

        const that = this

        for (const set of tableSets.values()) {
            const query = db(set.tableName).update(set.data)
            query.whereIn(`${set.tableName}.id`, function() {
                const q = this.select(`${set.tableName}.id`).from(set.tableName)
                set.join(q);
                if (filter) that.applyFilter(q, schema, filter)
            })

            await query.then()
        }
    }

    async query(entityName: string, options: QueryOptions): Promise<Json[]> {
        this.getDb() // ensure db is accessible
        const entitySchema = this.getEntitySchema(entityName)

        return await this.queryBySchema(entitySchema, options)
    }
    async insert(entityName: string, data: Json): Promise<{id: number}> {
        this.getDb()

        const entitySchema = this.getEntitySchema(entityName)

        if (!validateDataShape(entitySchema, data))
            throw new Error("Data does not match the schema")

        const [ result ] = await this.insertBySchema(entitySchema, data)

        return result
    }
    async update(entityName: string, options: UpdateOptions): Promise<void> {
        this.getDb()

        const entitySchema = this.getEntitySchema(entityName)

        await this.updateBySchema(entitySchema, options)
    }
    async delete(entityName: string, options: DeleteOptions): Promise<{id: number}[]> {
        const db = this.getDb()
        const entitySchema = this.getEntitySchema(entityName)

        const { filter } = options

        const query = db(entitySchema.tableName).del().returning("id")

        if (filter !== undefined)
            this.applyFilter(query, entitySchema, filter)

        return query.then<{ id: number }[]>()
    }
}
