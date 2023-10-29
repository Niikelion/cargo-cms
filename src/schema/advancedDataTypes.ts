import {nameGenerator, validatedDataType} from "./utils";
import {fieldConstraintsSchema} from "./reader";
import {z} from "zod";
import {getComponentType, getEntityType} from "./registry";
import {getTableName} from "../database/table";
import {isDefined} from "../utils/filters";
import {build, Table} from "../database/builder";
import {Structure, StructureField} from "./types";
import assert from "assert";
import {generateStructure} from "./index";

const componentDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    list: z.boolean().optional()
})

const componentDataType = validatedDataType("component", componentDataPayload, (table, name, data) => {
    const type = getComponentType(data.type)

    if (type == null)
        throw new Error("Internal error")

    const isList = data.list ?? false

    // if not using list, simply prefix all fields and add them to current table
    if (!isList)
        return type.fields.map(field => field.type.generateColumns(table, `${name}_${field.name}`, field.constraints)).filter(isDefined).flat()

    //otherwise, create separate table for items with link to current table
    const tableName = `${table.name}__${name}`

    const newTable = build.table(tableName)
    newTable.int("_entityId", c => c.references("_id").inTable(table.name))
    newTable.int("_order")

    const tables = type.fields.map(field => field.type.generateColumns(newTable, field.name, field.constraints)).filter(isDefined).flat()

    return [newTable, ...tables]
}, (table, name, data) => {
     const c = nameGenerator(name)

    const type = getComponentType(data.type)
    if (type == null)
        throw new Error("Internal error")

    const isList = data.list ?? false

    const fields: Record<string, StructureField> = {}
    const joins: Structure["joins"] = {}

    const tableName = isList ? `${table.name}__${name}` : table.name
    const newTable = isList ? build.table(tableName) : table

    const subStructures = type.fields.map(field => ({
        field,
        structure: field.type.generateStructure(newTable, isList ? field.name : c`${field.name}`, field.constraints)
    }))
    subStructures.forEach(structure => {
        fields[structure.field.name] = structure.structure.data
        Object.entries(structure.structure.joins).forEach(([name, value]) => {
            joins[name] = value
        })
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
            fetch: (db, id) => [ tableName, db(tableName).where({ _entityId: id }).orderBy("_order", "asc", "last") ],
            ...componentStructure
        }, joins: {}
    } satisfies Structure
}, data => {
    const type = getComponentType(data.type)

    if (type == null)
        return `Missing component type: ${data.type}`

    return null
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

const relationDataType = validatedDataType("relation", relationDataPayload, (table, name, data) => {
    const type = getEntityType(data.type)

    assert(type !== null)

    const relation = data.relation

    const otherTable = getTableName(type)

    //we only need to reference other table, use single field
    const singleReference = () => {
        table.int(name, c => c.nullable().references('_id').inTable(getTableName(type)))
        return null
    }

    //we need link table to connect entities across two tables
    const multiReference = (name: string, first: string, second: string) => {
        const newTable = build.table(name)

        newTable.int("_entityId", c => c.references("_id").inTable(first))
        newTable.int("_targetId", c => c.references("_id").inTable(second))

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
}, (table, name, data) => {
    const type = getEntityType(data.type)

    assert(type !== null)

    const relation = data.relation

    const otherTableName = getTableName(type)

    const structure = generateStructure(type)

    if (relation === "one" || relation === "oneToOne" || relation === "manyToOne") {
        return {
            data: structure.data,
            joins: {
                [otherTableName]: query => query.leftJoin(otherTableName, `${table.name}.${name}`, `${otherTableName}._id`),
                ...structure.joins
            }
        } satisfies Structure
    }

    if (relation === "many") {
        const linkTable = `${table.name}__${name}`

        return {
            data: {
                type: "array",
                ...structure,
                fetch: (db, id) => [otherTableName, db(linkTable).where({_entityId: id}).leftJoin(otherTableName, `${linkTable}._targetId`, `${otherTableName}._id`)]
            },
            joins: {}
        } satisfies Structure
    }

    assert(data.field !== undefined)

    const otherName = data.field

    const t1 = `${table.name}__${name}`
    const t2 =  `${otherTableName}__${otherName}`

    const getNames = () => {
        if (t1 < t2)
            return [t1, table.name, otherTableName, "_entityId", "_targetId"]

        return [t2, otherTableName, table.name, "_targetId", "_entityId"]
    }

    const [tableName, f, s, field, otherField] = getNames()

    return {
        data: {
            type: "array",
            ...structure,
            fetch: (db, id) => [otherTableName, db(tableName).where({[field]: id}).leftJoin(otherTableName, `${tableName}.${field}`, `${otherTableName}.${otherField}`)]
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

const dynamicComponentDataPayload = z.object({
    types: z.string().array(),
    list: z.boolean().optional(),
})

const dynamicComponentDataType = validatedDataType("dynamicComponent", dynamicComponentDataPayload, (table, name, data) => {
    const isList = data.list ?? false
    const c = nameGenerator(name)

    const types = data.types.map(getEntityType).filter(isDefined)

    let tables: Table<string>[] = []

    //create table for every type we want to be able to reference
    for (const type of types) {
        const typeTableName = `${table.name}__${name}__${type.name}`

        const newTable = build.table(typeTableName)

        const newTables = [newTable, ...type.fields.map(field => field.type.generateColumns(newTable, field.name, field.constraints)).filter(isDefined).flat()]

        newTables.forEach(table => tables.push(table))
    }

    //if not using list, simply add fields to reference other tables
    if (!isList) {
        table.int(c`key`)
        table.string(c`type`)
        return tables
    }

    const newTable = build.table(`${table.name}__${name}`)

    newTable.int("_entityId", c => c.references("_id").inTable(table.name))
    newTable.int("_order")
    newTable.string("_type")

    tables.push(newTable)

    return tables
}, (table, name, data) => {
    throw new Error("dynamic components not implemented")
}, data => {
    const types = data.types.map(type => [type, getEntityType(type)])

    for (const [typeName, typeValue] of types)
        if (typeValue === null)
            return `Missing entity type: ${typeName}`

    return null
})

export const advancedDataTypes = [
    componentDataType,
    relationDataType,
    dynamicComponentDataType
]