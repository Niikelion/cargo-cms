import {z} from "zod";
import {TypeRegistryModule} from "../../type-registry";
import {DebugModule} from "../../debug";
import {descendSelector, generateStructure, validatedDataType} from "@cargo-cms/database/schema/utils";
import {nameGenerator} from "@cargo-cms/utils/generators";
import {isArray, isDefined, isPrimitive} from "@cargo-cms/utils";
import {Table} from "@cargo-cms/database";
import {build} from "@cargo-cms/database";
import {Structure, StructureField} from "@cargo-cms/database/schema";
import assert from "assert";
import {JSONValue} from "@cargo-cms/utils";
import {queryByStructure} from "@cargo-cms/database/query";
import {insert} from "@cargo-cms/database/insert";

const dynamicComponentDataPayload = z.object({
    types: z.string().array(),
    list: z.boolean().optional(),
})

export const registerDynamicComponentDataType = (typeRegistry: TypeRegistryModule, debug: DebugModule) => {
    const { getComponentType } = typeRegistry

    const logSql = debug.channel("sql").log

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
                        const {table: typeTableName, alias: typeTableAlias} = typeData[tn]

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

        const isList = data.list

        assert(isList, "single item dynamic components not implemented")

        return null
    })

    typeRegistry.registerDataType(dynamicComponentDataType)
}