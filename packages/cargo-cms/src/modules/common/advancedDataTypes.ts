import {descendSelector, generateStructure, getTableName, validatedDataType} from "@cargo-cms/database/schema/utils";
import {Structure, StructureField} from "@cargo-cms/database/schema";
import {fieldConstraintsSchema} from "../schema-loader/reader";
import {z} from "zod";
import {build, Table} from "@cargo-cms/database";
import {isArray, isDefined, isNumber, isPrimitive, JSONValue} from "@cargo-cms/utils";
import {nameGenerator} from "@cargo-cms/utils/generators";
import assert from "assert";
import {TypeRegistryModule} from "../type-registry";
import {DebugModule} from "../debug";
import {queryByStructure} from "@cargo-cms/database/query";
import {insert} from "@cargo-cms/database/insert";

const componentDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    list: z.boolean().optional()
})

const targetedRelations = z.union([
    z.literal("oneToOne"),
    z.literal("oneToMany"),
    z.literal("manyToOne"),
    z.literal("manyToMany")
])

const relations = z.union([
    z.literal("one"),
    z.literal("many"),
    targetedRelations
])

type Relation = z.infer<typeof relations>

const relationDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    relation: relations,
    field: z.string().optional()
})

const relationDataTypeName = "relation"

const dynamicComponentDataPayload = z.object({
    types: z.string().array(),
    list: z.boolean().optional(),
})

export const registerAdvancedDataTypes = (typeRegistry: TypeRegistryModule, debug: DebugModule) => {
    const { getComponentType, getEntityType } = typeRegistry

    const logSql = debug.channel("sql").log

    const componentDataType = validatedDataType("component", componentDataPayload, (table, name, data, config) => {
        const type = getComponentType(data.type)

        if (type == null)
            throw new Error("Internal error")

        const isList = data.list ?? false

        // if not using list, simply prefix all fields and add them to current table
        if (!isList)
            return type.fields.map(field => field.type.generateColumns(table, `${name}_${field.name}`, field.constraints, config)).filter(isDefined).flat()

        //otherwise, create separate table for items with link to current table
        const tableName = `${table.name}__${name}`

        const newTable = build.table(tableName)
        newTable.int("_entityId", c => c.references("_id", { onDelete: "CASCADE" }).inTable(table.name))
        newTable.int("_order")
        newTable.composite(["_entityId", "_order"])

        const tables = type.fields.map(field => field.type.generateColumns(newTable, field.name, field.constraints, config)).filter(isDefined).flat()

        return [newTable, ...tables]
    }, ({table, path, data, selector, ...args}) => {
        const c = nameGenerator(path)

        const type = getComponentType(data.type)
        if (type == null)
            throw new Error("Internal error")

        const isList = data.list ?? false

        const fields: Record<string, StructureField> = {}
        const joins: Structure["joins"] = {}

        const tableName = isList ? `${table}__${path}` : table
        const newTable = isList ? tableName : table

        const subStructures = type.fields.map(field => {
            const fieldSelector = descendSelector(selector, field.name)
            if (fieldSelector === null)
                return null

            return ({
                field,
                structure: field.type.generateStructure({
                    ...args,
                    table: newTable,
                    path: isList ? field.name : c`${field.name}`,
                    data: field.constraints,
                    selector: fieldSelector
                })
            });
        }).filter(isDefined)
        subStructures.forEach(structure => {
            fields[structure.field.name] = structure.structure.data
            Object.entries(structure.structure.joins).forEach(([name, value]) =>
                joins[name] = value)
        })

        const componentStructure = {
            data: {
                type: "object", fields
            }, joins
        } satisfies Structure

        if (!isList)
            return componentStructure

        return {
            data: {
                type: "array",
                fetch: {
                    table: tableName,
                    query: (db, id) => db(tableName).where({ _entityId: id }).orderBy("_order", "asc", "last")
                },
                upload: {
                    table: tableName,
                    getLinkData: (id, i) => ({ _entityId: id, _order: i })
                },
                ...componentStructure
            }, joins: {}
        } satisfies Structure
    }, data => {
        const type = getComponentType(data.type)

        if (type == null)
            return `Missing component type: ${data.type}`

        return null
    })

    const relationDataType = validatedDataType(relationDataTypeName, relationDataPayload, (table, name, data) => {
        const type = getEntityType(data.type)

        assert(type !== null)

        const relation = data.relation

        const otherTable = getTableName(type)

        //we only need to reference other table, use single field
        const singleReference = () => {
            table.int(name, c => c.nullable().references('_id', { onDelete: "SET NULL" }).inTable(getTableName(type)))
            return null
        }

        //we need link table to connect entities across two tables
        const multiReference = (name: string, first: string, second: string) => {
            const newTable = build.table(name)

            newTable.int("_entityId", c => c.references("_id", { onDelete: "CASCADE" }).inTable(first))
            newTable.int("_targetId", c => c.references("_id", { onDelete: "CASCADE" }).inTable(second))
            newTable.composite(["_entityId", "_targetId"])

            return [ newTable ]
        }

        const relationHandlers = {
            oneToMany: () => null,
            one: singleReference, manyToOne: singleReference, oneToOne: singleReference,
            many: () => multiReference(`${table.name}__${name}`, table.name, otherTable),
            manyToMany: () => {
                assert(data.field !== undefined)

                const otherName = data.field

                const t1 = `${table.name}__${name}`
                const t2 =  `${otherTable}__${otherName}`

                const getNames = () => {
                    if (t1 < t2)
                        return [t1, table.name, otherTable]

                    return [t2, otherTable, table.name]
                }

                const [tableName, f, s] = getNames()

                return multiReference(tableName, f, s)
            }
        } as const satisfies Record<Relation, () => Table<string>[] | null>

        return relationHandlers[relation]()
    }, (args): Structure => {
        const {
            table,
            path,
            data,
            selector,
            uuidGenerator
        } = args

        const relation = data.relation

        const isSimpleRelation = relation === "one" || relation === "oneToOne" || relation === "manyToOne"

        const type = getEntityType(data.type)

        assert(type !== null)

        const otherTableName = getTableName(type)
        const otherTableAlias = uuidGenerator()

        const follow = selector !== "**"

        const structure = generateStructure(type, follow ? selector : {}, {uuidGenerator, tableName: isSimpleRelation ? otherTableAlias : undefined})

        if (isSimpleRelation) {

            assert(structure.data.type === "object")

            return {
                data: {
                    ...structure.data,
                    upload: {
                        type: "outwards",
                        getLinkData: value => {
                            assert(isNumber(value))
                            return {[path]: value}
                        }
                    }
                },
                joins: {
                    [otherTableAlias]: {
                        table: otherTableName,
                        build: query =>
                            query.leftJoin(
                                `${otherTableName} AS ${otherTableAlias}`,
                                `${table}.${path}`,
                                `${otherTableAlias}._id`)
                    },
                    ...structure.joins
                }
            } satisfies Structure
        }

        if (relation === "many") {
            const linkTable = `${table}__${path}`

            return {
                data: {
                    type: "array",
                    ...structure,
                    fetch: {
                        table: otherTableName,
                        query: (db, id) =>
                            db(linkTable).where({_entityId: id}).leftJoin(otherTableName, `${linkTable}._targetId`, `${otherTableName}._id`)
                    },
                    upload: {
                        table: linkTable,
                        getLinkData: (id, _, v) => {
                            assert(isNumber(v))
                            return ({_entityId: id, _targetId: v});
                        }
                    }
                },
                joins: {}
            } satisfies Structure
        }

        assert(data.field !== undefined)

        const otherName = data.field
        if (relation === "oneToMany") {
            return {
                data: {
                    type: "array",
                    ...structure,
                    fetch: {
                        table: otherTableName,
                        query: (db, id) =>
                            db(otherTableName).where({[otherName]: id})
                    },
                    upload: async (db, id, _, v) => {
                        assert(isNumber(v))

                        const query = db(otherTableName).update({[otherName]: id}).where('_id', v)

                        logSql(query.toSQL().sql)

                        await query.then()
                    }
                },
                joins: {}
            } satisfies Structure
        }

        const t1 = `${table}__${path}`
        const t2 = `${otherTableName}__${otherName}`

        const getNames = () => {
            if (t1 < t2)
                return [t1, "_entityId", "_targetId"]

            return [t2, "_targetId", "_entityId"]
        }

        const [tableName, field, otherField] = getNames()

        return {
            data: {
                type: "array",
                ...structure,
                fetch: {
                    table: otherTableName,
                    query: (db, id) =>
                        db(tableName).where({[field]: id}).leftJoin(otherTableName, `${tableName}.${field}`, `${otherTableName}.${otherField}`)
                },
                upload: {
                    table: tableName,
                    getLinkData: (id, _, v) => {
                        assert(isNumber(v))
                        return ({[field]: id, [otherField]: v});
                    }
                }
            },
            joins: {}
        } satisfies Structure
    }, data => {
        const type = getEntityType(data.type)

        const relation = data.relation

        if (type == null)
            return `Missing entity type: ${data.type}`

        if (relation !== "one" && relation !== "many" && data.field === undefined)
            return `Linked field in entity type ${data.type} not specified`

        return null
    })
    const dynamicComponentDataType = validatedDataType("dynamicComponent", dynamicComponentDataPayload, (table, name, data, config) => {
        const isList = data.list ?? false
        const c = nameGenerator(name)

        const types = data.types.map(getComponentType).filter(isDefined)

        let tables: Table<string>[] = []


        const bridgeTableName = `${table.name}__${name}`
        const makeName = (n: string) => `${bridgeTableName}__${n}`

        //create table for every type we want to be able to reference
        for (const type of types) {
            const typeTableName = makeName(type.name.replace(/\./g, '_'))

            const newTable = build.table(typeTableName)
            newTable.int("_entryId", c => c.references("_id", { onDelete: 'CASCADE' }).inTable(bridgeTableName))

            const newTables = [newTable, ...type.fields.map(field => field.type.generateColumns(newTable, field.name, field.constraints, config)).filter(isDefined).flat()]

            newTables.forEach(table => tables.push(table))
        }

        //if not using list, simply add fields to reference other tables
        if (!isList) {
            table.int(c`key`)
            table.string(c`type`)
            return tables
        }

        const bridgeTable = build.table(bridgeTableName)

        bridgeTable.int("_entityId", c => c.references("_id", { onDelete: 'CASCADE' }).inTable(table.name))
        bridgeTable.int("_order")
        bridgeTable.string("_type")

        tables.push(bridgeTable)

        return tables
    }, ({data, table, path, selector, uuidGenerator}) => {
        const fields: Record<string, StructureField & {type: "object"}> = {}

        const isList = data.list ?? false
        const types = data.types.map(getComponentType).filter(isDefined)

        const joins: Structure["joins"] = {}

        const newTableName = `${table}__${path}`

        const typeData: Record<string, {
            name: string
            table: string
            alias: string
            structure: StructureField & {type: "object"}
        }> = {}

        for (const type of types) {
            const tn = type.name.replace(/\./g, '_')

            const subSelector = descendSelector(selector, tn)

            if (subSelector == null)
                continue


            const typeTableName = `${newTableName}__${tn}`
            const typeTableAlias = uuidGenerator()

            const subStructureForUpload = generateStructure(type, subSelector, {uuidGenerator, tableName: typeTableName})

            assert(subStructureForUpload.data.type === "object")

            typeData[tn] = {
                name: type.name,
                table: typeTableName,
                alias: typeTableAlias,
                structure: subStructureForUpload.data
            }

            const subStructure = generateStructure(type, subSelector, {uuidGenerator, tableName: typeTableAlias})

            joins[typeTableAlias] = {
                table: typeTableName,
                build: (builder) => builder
            }

            assert(subStructure.data.type == "object")

            fields[type.name.replace(/\./g, '_')] = subStructure.data
            Object.entries(subStructure.joins).forEach(([key, join]) =>
                joins[key] = join)
        }

        assert(isList, "single item dynamic components not implemented")

        return {
            data: {
                type: "custom",
                fetch: async (db, id) => {
                    const ret: {order: number, [k: string]: JSONValue}[] = []
                    for (const type of types) {
                        const tn = type.name.replace(/\./g, '_')
                        const {table: typeTableName, alias: typeTableAlias, structure} = typeData[tn]

                        const query = db(newTableName)
                            .select()
                            .where(`${newTableName}._type`, '=', type.name)
                            .andWhere(`${newTableName}._entityId`, '=', id)
                            .leftJoin(
                                `${typeTableName} as ${typeTableAlias}`,
                                `${newTableName}._id`,
                                `${typeTableAlias}._entryId`
                            )
                        const res = await queryByStructure(db, {
                            data: {
                                type: "object",
                                fields: {
                                    order: {
                                        type: "number",
                                        id: `${newTableName}._order`
                                    },
                                    [tn]: fields[tn]
                                }
                            },
                            joins: {}
                        }, typeTableAlias, {logSql, query}) as typeof ret
                        res.forEach(row => ret.push(row))
                    }
                    return ret
                        .sort((a, b) => a.order - b.order)
                        .map(({order, ...rest}) => rest)
                },
                upload: async (db, id, value) => {
                    assert(isArray(value))

                    await Promise.all(value.map(async (item, i) => {
                        assert(!isArray(item) && !isPrimitive(item))

                        const entries = Object.entries(item)
                        assert(entries.length === 1)

                        const [type, v] = entries[0]

                        assert(!isArray(v) && !isPrimitive(v))

                        const field = typeData[type].structure

                        const data = typeData[type]

                        await insert(db, {
                            data: {
                                type: "object",
                                fields: {
                                    _entityId: {
                                        type: "number",
                                        id: `${newTableName}._entityId`
                                    },
                                    _order: {
                                        type: "number",
                                        id: `${newTableName}._order`
                                    },
                                    _type: {
                                        type: "number",
                                        id: `${newTableName}._type`
                                    },
                                    [type]: {
                                        type: "object",
                                        fields: field.fields,
                                        upload: {
                                            type: "inwards",
                                            table: data.table,
                                            getLinkData(id, v) {
                                                assert(!isPrimitive(v) && !isArray(v))
                                                return {...v, _entryId: id}
                                            }
                                        }
                                    } satisfies StructureField
                                }
                            },
                            joins
                        }, newTableName, {_entityId: id, _order: i, _type: data.name, [type]: v}, logSql)
                    }))
                }
            },
            joins
        } satisfies Structure
    }, data => {
        const types = data.types.map(type => [type, getComponentType(type)])

        for (const [typeName, typeValue] of types)
            if (typeValue === null)
                return `Missing component type: ${typeName}`

        return null
    })

    const types = [
        componentDataType,
        relationDataType,
        dynamicComponentDataType
    ]

    types.forEach(typeRegistry.registerDataType)
}