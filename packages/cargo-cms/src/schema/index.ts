import {Schema, SchemaField} from "@cargo-cms/database/schema";
import {SchemaFile, SchemaFileFieldSchema} from "./reader";
import {pick} from "@cargo-cms/utils/objects";
import {basicDataTypes} from "./basicDataTypes";
import {getDataType, registerDataType} from "./registry";
import {advancedDataTypes} from "./advancedDataTypes";

export * from "./registry"

[
    ...basicDataTypes,
    ...advancedDataTypes
].forEach(registerDataType)

export const schemaToJson = (schema: Schema): SchemaFile => {
    return {
        ...pick(schema, ["type", "name", "description"]),
        description: {
            ...pick(schema.description, ["description", "icon"]),
            path: schema.description.path.join("/")
        },
        fields: schema.fields.map<SchemaFileFieldSchema>(field => ({
            ...pick(field, ["name", "constraints"]),
            type: field.type.name,
            description: {
                ...pick(field.description, ["description", "order", "visible"]),
                path: field.description.path.join("/")
            }
        } satisfies SchemaFileFieldSchema))
    } satisfies SchemaFile
}

export const schemaFromJson = (schemaFile: SchemaFile): Schema => {
    const fields = schemaFile.fields.map(rawField => {
        const type = getDataType(rawField.type)

        if (type == null)
            throw new Error(`Unknown data type: ${rawField.type}, have you forgot to install some plugins?`)

        return {
            ...pick(rawField, ["name", "constraints"]),
            type,
            description: {
                ...pick(rawField.description, ["description", "order"]),
                visible: rawField.description.visible ?? true,
                path: rawField.description.path.split("/")
            }
        } satisfies SchemaField
    })

    return {
        ...pick(schemaFile, ["name", "type"]),
        description: {
            ...pick(schemaFile.description, ["description", "icon"]),
            path: schemaFile.description.path.split("/")
        },
        fields
    } satisfies Schema
}