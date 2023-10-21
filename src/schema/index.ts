import {DataType, Schema, SchemaField} from "./types";
import {SchemaFile} from "./reader";
import {pick} from "../utils/objects";
import {basicDataTypes} from "./basicDataTypes";

const supportedTypes: Record<string, DataType> = {}

export const registerDataType = (type: DataType): void => {
    if (type.name in supportedTypes)
        throw new Error(`Data type ${type.name} is already registered`)

    supportedTypes[type.name] = type
}

basicDataTypes.forEach(registerDataType)

export const getDataType = (name: string): DataType | null => {
    if (name in supportedTypes)
        return supportedTypes[name]

    return null
}

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