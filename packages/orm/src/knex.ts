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
    isOperationFilter,
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
import {DeleteOptions, FilterType, QueryOptions, ResponseSelector, SortType, UpdateOptions} from "./operations";
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

type EnrichedFieldSchema = EnrichmentData & (PrimitiveFieldSchema | RelationFieldSchema)
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

const relationNeedsLinkTable = (schema: RelationFieldSchema): boolean => {
    if (!schema.bidirectional) {
        return schema.multiple
    }

    return schema.multiple || schema.targetField.multiple
}

const shouldCreateLinkTable = (schema: RelationFieldSchema, sourceTable: string, targetTable: string): boolean =>
    !(schema.bidirectional && schema.targetField.multiple && (!schema.multiple || targetTable < sourceTable))

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

            if (enrichedElementsSchema.type !== "object")
                throw new Error("Only arrays of objects are permitted")

            enrichedSchema = { ...schema, elements: enrichedElementsSchema, tableName: arrayTableName }
            break
        }
        case "relation": {
            const target = makeTableName.entity(schema.target)

            // skip when bidirectional relation link table is created by other end of relation
            // that is, when other side is multiple, and either this side is not, or it is but target table name is lexicographically smaller
            if (!shouldCreateLinkTable(schema, sourceTableName, target)) break

            if (relationNeedsLinkTable(schema)) {
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
    return targetTableName
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
        case "relation":
            return value === null || isNumber(value)
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
    parentId?: number,
    arrayFilter?: (query: Knex.QueryBuilder) => void
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

    private applyFilter(query: Knex.QueryBuilder, schema: EnrichedDataSchema, filter: FilterType, joinedTables?: Set<string>): void {
        type Q = Knex.QueryBuilder
        if (isOperationFilter(filter)) {
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

            if (schema.type === "array") return
            if (schema.type === "object") return
            const p = `${schema.tableName}.${schema.fieldName}`

            if ("$eq" in filter) return void query.where(p, `=`, filter.$eq)
            if ("$neq" in filter) return void query.where(p, `<>`, filter.$neq)
            if ("$lt" in filter) return void query.where(p, `<`, filter.$lt)
            if ("$lte" in filter) return void query.where(p, `<=`, filter.$lte)
            if ("$gt" in filter) return void query.where(p, `>`, filter.$gt)
            if ("$gte" in filter) return void query.where(p, `>=`, filter.$gte)
            if ("$like" in filter) return void query.where(p, `like`, filter.$like)
            if ("$null" in filter) return void (filter.$null ? query.whereNull(p) : query.whereNotNull(p))
            if ("$in" in filter) return void query.whereIn(p, filter.$in)
            if ("$between" in filter) return void query.whereBetween(p, filter.$between)

            return
        }

        //TODO: handle for relation
        if (schema.type !== "object") throw new Error("Cannot access properties of primitive value")

        for (const path in filter) {
            const innerFilter = filter[path]

            const parts = path.split(".")
            let s: EnrichedDataSchema = schema
            for (const part of parts) {
                //TODO: handle single field relations
                if (s.type !== "object")
                    throw new Error("Incorrect path")

                s = s.fields[part]
            }

            this.applyFilter(query, s, innerFilter, joinedTables)
        }
    }

    private applySort(query: Knex.QueryBuilder, schema: EnrichedDataSchema, sort: SortType, joinedTables?: Set<string>) {
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

            parts.forEach(part => {
                //TODO: handle relations
                if (currentSchema.type !== "object") throw new Error("Incorrect path")

                currentSchema = currentSchema.fields[part]
            })

            if (currentSchema.type === "array" || currentSchema.type === "object" || currentSchema.type === "relation")
                throw new Error("Incorrect path")

            return {
                column: `${currentSchema.tableName}.${currentSchema.fieldName}`,
                order: knexOrder
            }
        })

        query.orderBy(sortList)
    }

    private async queryByStructure(schema: EnrichedDataSchema, options: QueryByStructureOptions): Promise<Json[]> {
        const db = this.getDb()

        const {
            filter,
            sort,
            selector,
            limit,
            offset,
            parentId,
            arrayFilter
        } = options

        if (schema.type === "array") {
            if (arrayFilter)
                throw new Error("Internal error, unhandled nested array")

            // no parent id to link array to, return
            if (parentId === undefined) return []

            return await this.queryByStructure(schema.elements, {
                arrayFilter: (query) =>
                    query
                        .join(schema.tableName, `${schema.tableName}.elementId`, `${schema.elements.tableName}.id`)
                        .where(`${schema.tableName}.parentId`, `=`, parentId),
                selector
            })
        }

        if (schema.type === "relation") {
            //TODO: get relation by link table or parent id
            return []
        }

        // at this point only type that should be accessible is an object
        if (schema.type !== "object") return []

        type Field = {
            path: string
            field: string
            table: string
            type: FieldType
        }
        type ArrayField = {
            path: string
            schema: EnrichedDataSchema
            selector: ResponseSelector
        }
        type Join = {
            source: string
            sourceField: string
            target: string
            targetAlias: string
        }

        const tableFields: Field[] = []
        const arrayFields: ArrayField[] = []
        const joins: Join[] = []

        const recursiveFieldExtract = (path: string, fieldSchema: EnrichedDataSchema, selector: ResponseSelector | undefined) => {
            if (!selector) return

            switch (fieldSchema.type) {
                case "array":
                    return arrayFields.push({ path, schema: fieldSchema, selector })
                case "relation":
                    if (relationNeedsLinkTable(fieldSchema))
                        return arrayFields.push({path, schema: fieldSchema, selector})

                    const alias = joinTableAlias(schema.tableName, fieldSchema.tableName, fieldSchema.fieldName)
                    joins.push({ sourceField: fieldSchema.fieldName, source: schema.tableName, target: fieldSchema.tableName, targetAlias: alias })
                    const target = this.getEntitySchema(fieldSchema.target)
                    return recursiveFieldExtract(path, {...target, tableName: alias}, selector)
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
            query.join({[join.targetAlias]: join.target}, `${join.source}.${join.sourceField}`, `${join.target}.id`)
            joinedTables.add(join.targetAlias)
        }

        if (limit !== undefined) query.limit(limit)
        if (offset !== undefined) query.offset(offset)
        if (arrayFilter !== undefined) arrayFilter(query)
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
                const array = await this.queryByStructure(field.schema, {
                    parentId: id,
                    selector: field.selector
                })

                const expectsSingleElement = field.schema.type === "relation" && field.schema.bidirectional && !field.schema.targetField.multiple

                setByPath(result, field.path, expectsSingleElement ? array[0] ?? null : array)
            }

            results.push(result)
        }

        return results
    }

    async query(entityName: string, options: QueryOptions): Promise<Json[]> {
        this.getDb() // ensure db is accessible
        const entitySchema = this.getEntitySchema(entityName)

        return await this.queryByStructure(entitySchema, options)
    }

    async insertBySchema(schema: EnrichedDataSchema, value: Json, transaction: Knex.Transaction): Promise<{id: number}[]> {
        const db = this.getDb()

        switch (schema.type) {
            case "object": {
                assert.ok(isObject(value))

                const obj: Record<string, PrimitiveType | null> = {}
                const arrayFields: { value: Json, schema: EnrichedArraySchema }[] = []

                const extractFields = (schema: EnrichedDataSchema, value: Json) => {
                    switch(schema.type) {
                        case "array":
                            assert.ok(isArray(value))
                            return arrayFields.push({ value, schema })
                        case "object":
                            assert.ok(isObject(value))
                            return Object.entries(schema.fields).forEach(([key, field]) => extractFields(field, value[key]))
                        case "relation":
                            throw new Error("Relation insert not implemented")
                        default:
                            assert.ok(isNumber(value) || isString(value) || isBoolean(value) || value === null)
                            return obj[schema.fieldName] = transformValue(value, schema.type)
                    }
                }

                extractFields(schema, value)

                const [{ id }] = await db(schema.tableName).insert(obj).returning("id").transacting(transaction)

                for (const field of arrayFields) {
                    const elements = await this.insertBySchema(field.schema, field.value, transaction)
                    await db(field.schema.tableName).insert(elements.map((e, i) => ({ parentId: id, elementId: e.id, order: i })))
                }

                return [{ id }]
            }
            case "relation":
                throw new Error("Relation insert not implemented")
            case "array": {
                assert.ok(isArray(value))

                const { elements } = schema

                const result: {id: number}[] = []

                for (const element of value) {
                    const [r] = await this.insertBySchema(elements, element, transaction)
                    result.push(r)
                }

                return result
            }
            default:
                throw new Error("Internal error, field should be handled by parent schema")
        }
    }

    async insert(entityName: string, data: Json): Promise<{id: number}> {
        const db = this.getDb()
        const transaction = await db.transaction()

        const entitySchema = this.getEntitySchema(entityName)

        if (!validateDataShape(entitySchema, data))
            throw new Error("Data does not match the schema")

        const [ result ] = await this.insertBySchema(entitySchema, data, transaction)

        await transaction.commit()

        return result
    }
    async update(entityName: string, options: UpdateOptions): Promise<{id: number}[]> {
        const db = this.getDb()
        //

        throw new Error("Update not implemented")
    }
    async delete(entityName: string, options: DeleteOptions): Promise<{id: number}[]> {
        const db = this.getDb()
        const entitySchema = this.getEntitySchema(entityName)

        const query = db(entitySchema.tableName).del().returning("id")

        const { filter } = options

        if (filter !== undefined)
            this.applyFilter(query, entitySchema, filter)

        return query.then<{ id: number }[]>()
    }
}
