import {DatabaseDriver, DataSchema, PrimitiveFieldSchema, TypeSchema} from "./types";
import knex, {Knex} from "knex";

type TableField = PrimitiveFieldSchema | {
    type: "link",
    target: string
}

type TableSchema = {
    name: string
    fields: Record<string, TableField>
}

const extendPath = (path: string, extension: string): string => path.length > 0 ? `${path}_${extension}` : extension
const escape = (path: string): string => path.replace(/_/, "__")

function flattenSchema(source: string, path: string, schema: DataSchema): { fields: Record<string, TableField>, additionalTables: Record<string, TableSchema> } {
    const additionalTables: Record<string, TableSchema> = {}

    const assertFreshTable = (tableName: string) => {
        if (tableName in additionalTables) throw new Error(`Duplicate table ${tableName}`)
    }

    const fields: Record<string, TableField> = {}

    switch (schema.type) {
        case "object": {
            for (const fieldName in schema.fields) {
                const field = schema.fields[fieldName]
                const {
                    fields: recursiveFields,
                    additionalTables: recursiveAdditionalTables
                } = flattenSchema(source, extendPath(path, escape(fieldName)), field)

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
            //todo: better naming
            const arrayTableName = `item_${source}_${path}`
            const linkTableName = `link_${source}_${arrayTableName}`

            assertFreshTable(linkTableName)
            assertFreshTable(arrayTableName)

            const {
                fields: arrayFields,
                additionalTables: arrayAdditionalTables
            } = flattenSchema(arrayTableName, "", schema.elements)

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
            if (!schema.bidirectional) {
                if (!schema.multiple) {
                    fields[path] = {
                        type: "link",
                        target: schema.target,
                    }
                    break
                }

                const linkTableName = `link_${source}_${path}_${schema.target}`
                assertFreshTable(linkTableName)

                additionalTables[linkTableName] = {
                    name: linkTableName,
                    fields: {
                        parentId: { type: "link", target: source },
                        targetId: { type: "link", target: schema.target }
                    }
                }
                break
            }
            throw new Error("Deep relation not supported")
        }
        default: {
            fields[path] = schema
            break
        }
    }

    return { fields, additionalTables }
}

function typeSchemaToTables(schema: TypeSchema): Record<string, TableSchema> {
    const tableName = `entity_${escape(schema.name)}`
    const { fields, additionalTables: tables } = flattenSchema(tableName,"", schema)

    const table = { name: tableName, fields } satisfies TableSchema

    if (table.name in tables)
        throw new Error(`Duplicate table ${table.name}`)

    tables[table.name] = table

    return tables
}

export class KnexDriver implements DatabaseDriver {
    private db: Knex

    constructor(config: Knex.Config, currentSchema: Record<string, TypeSchema>) {
        this.db = knex(config)
        console.dir({currentSchema}, {depth: 20})
    }

    async close(): Promise<void> {
        return this.db.destroy()
    }

    applySchema(types: Record<string, TypeSchema>): Promise<void> {
        throw new Error("Method not implemented.");
    }
}