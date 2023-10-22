import {Schema, SchemaField} from "./types";
import {SchemaFile} from "./reader";
import {pick} from "../utils/objects";
import {basicDataTypes} from "./basicDataTypes";
import {getDataType, registerDataType} from "./registry";
import {advancedDataTypes} from "./advancedDataTypes";

export * from "./registry"

[
    ...basicDataTypes,
    ...advancedDataTypes
].forEach(registerDataType)

export const constructSchema = (schemaFile: SchemaFile): Schema => {
    const fields = schemaFile.fields.map(rawField => {
        const type = getDataType(rawField.type)

        if (type == null)
            throw new Error(`Unknown data type: ${rawField.type}, have you forgot to install some plugins?`)

        return {
            ...pick(rawField, ["name", "constraints"]),
            type,
            description: {
                ...pick(rawField.description, ["description", "order", "visible"]),
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