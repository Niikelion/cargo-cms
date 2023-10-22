import {validatedDataType} from "./utils";
import {fieldConstraintsSchema} from "./reader";
import {z} from "zod";
import {getComponentType, getEntityType} from "./registry";
import {getTableName} from "../database/table";

const componentDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    list: z.boolean().optional()
}).required()

const componentDataType = validatedDataType("component", componentDataPayload, (builder, name, data) => {
    const type = getComponentType(data.type)

    if (type == null)
        throw new Error("Internal error")

    const isList = data.list ?? false

    for (const field of type.fields) {
        field.type.generateField(builder, `${name}_${field.name}`, field.constraints)
    }
}, data => {
    const type = getComponentType(data.type)

    if (type == null)
        return `Missing component type: ${data.type}`

    return null
})

const relationDataPayload = fieldConstraintsSchema.extend({
    type: z.string()
}).required()

const relationDataType = validatedDataType("relation", relationDataPayload, (builder, name, data) => {
    const type = getEntityType(data.type)

    if (type == null)
        throw new Error("Internal error")

    builder.integer(name)

    builder.foreign(`${name}_key`).references('id').inTable(getTableName(type))
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