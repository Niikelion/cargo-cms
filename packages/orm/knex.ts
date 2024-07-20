import {DatabaseDriver, DataSchema, PrimitiveFieldSchema, TypeSchema} from "./types";
import knex, {Knex} from "knex";
import md5 from "md5"

type TableField = PrimitiveFieldSchema | {
    type: "link",
    target: string
}

type TableSchema = {
    name: string
    fields: Record<string, TableField>
}

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
    fields: Record<string, TableField>,
    additionalTables: Record<string, TableSchema>
}

const makeTableNameCreator = (config: TableCreationConfig) => {
    const makeTableName = (tableType: string, name: string): string => {
        const rawName = `${tableType}_${escape(name)}`

        if (!config.mangleTableNames) return rawName

        return md5(rawName).substring(0, 16)
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

function flattenSchema(source: string, path: string, schema: DataSchema, config: TableCreationConfig): FlattenedSchema {
    const additionalTables: Record<string, TableSchema> = {}

    const assertFreshTable = (tableName: string) => {
        if (tableName in additionalTables) throw new Error(`Duplicate table ${tableName}`)
    }

    const fields: Record<string, TableField> = {}

    const makeTableName = makeTableNameCreator(config)

    switch (schema.type) {
        case "object": {
            for (const fieldName in schema.fields) {
                const field = schema.fields[fieldName]
                const {
                    fields: recursiveFields,
                    additionalTables: recursiveAdditionalTables
                } = flattenSchema(source, extendPath(path, fieldName), field, config)

                Object.entries(recursiveFields).forEach(([key, value]) => {
                    if (key in fields)
                        throw new Error(`Duplicate field ${key}`)
                    fields[key] = value;
                })
                Object.entries(recursiveAdditionalTables).forEach(([key, value]) => {
                    assertFreshTable(key)
                    additionalTables[key] = value
                })
            }
            break
        }
        case "array": {
            //TODO: better naming
            const arrayTableName = makeTableName.item(source, path)
            const linkTableName = makeTableName.link(source, path, arrayTableName)

            assertFreshTable(linkTableName)
            assertFreshTable(arrayTableName)

            const {
                fields: arrayFields,
                additionalTables: arrayAdditionalTables
            } = flattenSchema(arrayTableName, "", schema.elements, config)

            additionalTables[linkTableName] = {
                name: linkTableName,
                fields: {
                    parentId: { type: "link", target: source },
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

            break
        }
        case "relation": {
            const target = makeTableName.entity(schema.target)

            // skip when bidirectional relation link table is created by other end of relation
            // that is, when other side is multiple, and either this side is not, or it is but target table name is lexicographically smaller
            if (schema.bidirectional && schema.targetField.multiple && (!schema.multiple || target < source)) break

            if (schema.multiple) {
                const getFieldsAndTableName = () => {
                    if (!schema.bidirectional) return [ makeTableName.link(source, path, target), "parentId", "targetId" ]

                    if (schema.targetField.multiple) return [ makeTableName.relation(source, target), `${source}_id`, `${target}_id` ]

                    return [ makeTableName.link(target, schema.targetField.path, source), "targetId", "parentId" ]
                }

                const [linkTableName, sourceField, targetField] = getFieldsAndTableName()

                assertFreshTable(linkTableName)

                additionalTables[linkTableName] = {
                    name: linkTableName,
                    fields: {
                        [sourceField]: { type: "link", target: source },
                        [targetField]: { type: "link", target: target }
                    }
                }

                break
            }

            fields[path] = { type: "link", target: schema.target }
            break
        }
        default: {
            fields[path] = schema
            break
        }
    }

    return { fields, additionalTables }
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

function typeSchemaToTables(schema: TypeSchema, config: TableCreationConfig): Record<string, TableSchema> {
    const makeTableName = makeTableNameCreator(config)
    const tableName = makeTableName.entity(schema.name)
    const { fields, additionalTables: tables } = flattenSchema(tableName,"", schema, config)

    const table = { name: tableName, fields } satisfies TableSchema

    if (table.name in tables)
        throw new Error(`Duplicate table ${table.name}`)

    tables[table.name] = table

    return tables
}

type AdditionalConfig = Pick<TableCreationConfig, "mangleTableNames" | "mangleFieldNames">

export class KnexDriver implements DatabaseDriver {
    private db: Knex

    constructor(config: Knex.Config & AdditionalConfig, currentSchema: Record<string, TypeSchema>) {
        this.db = knex(config)
        console.dir({currentSchema}, {depth: 20})
        const tables = combineTableDefinitions(Object.values(currentSchema).map(t => typeSchemaToTables(t, config)))

        console.dir({tables}, {depth: 20})
    }

    async close(): Promise<void> {
        return this.db.destroy()
    }

    applySchema(types: Record<string, TypeSchema>): Promise<void> {
        throw new Error("Method not implemented.");
    }
}