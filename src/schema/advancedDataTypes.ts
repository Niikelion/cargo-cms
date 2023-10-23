import {validatedDataType} from "./utils";
import {fieldConstraintsSchema} from "./reader";
import {z} from "zod";
import {getComponentType, getEntityType} from "./registry";
import {getTableName} from "../database/table";

const componentDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    list: z.boolean().optional()
})

const componentDataType = validatedDataType("component", componentDataPayload, (builder, name, data, table) => {
    const type = getComponentType(data.type)

    if (type == null)
        throw new Error("Internal error")

    const isList = data.list ?? false

    if (!isList) {
        for (const field of type.fields) {
            field.type.generateField(builder, `${name}_${field.name}`, field.constraints, table)
        }
    } else {
        const tableName = `${table}__${name}`

        builder.additionalTable(tableName, builder => {
            const key = builder.integer("_entityId")
            builder.useField("_entityId", key)

            builder.foreign("_entityId").references("_id").inTable(table)

            const order = builder.integer("_order")
            builder.useField("_order", order)

            for (const field of type.fields) {
                field.type.generateField(builder, field.name, field.constraints, tableName)
            }
        })
    }
}, data => {
    const type = getComponentType(data.type)

    if (type == null)
        return `Missing component type: ${data.type}`

    return null
})

const relations = z.union([
    z.literal("one"),
    z.literal("many")
])

type Relations = z.infer<typeof relations>

const relationDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    relation: relations
}).required()

//TODO: instead of simple links, add proper relations like oneToMany, oneToOne, manyToOne and manyToMany
const relationDataType = validatedDataType("relation", relationDataPayload, (builder, name, data) => {
    const type = getEntityType(data.type)

    if (type == null)
        throw new Error("Internal error")

    const relation = data.relation

    const relationHandlers = {
        "one": () => {
            const key = builder.integer(name)
            builder.useField(name, key)

            builder.foreign(name).references('id').inTable(getTableName(type))
        },
        "many": () => {
            //TODO: create additional table of links
            console.error("relation many not implemented")
        }
    }

    relationHandlers[relation]()
}, data => {
    const type = getEntityType(data.type)

    if (type == null)
        return `Missing entity type: ${data.type}`

    return null
})

export const advancedDataTypes = [
    componentDataType,
    relationDataType
]