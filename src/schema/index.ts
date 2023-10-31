import {Schema, SchemaField, SelectorStructure, Structure, StructureField} from "./types";
import {SchemaFile, SchemaFileFieldSchema} from "./reader";
import {pick} from "../utils/objects";
import {basicDataTypes} from "./basicDataTypes";
import {getDataType, registerDataType} from "./registry";
import {advancedDataTypes} from "./advancedDataTypes";
import {getTableName} from "../database/table";
import {descendSelector} from "./utils";

export * from "./registry"

[
    ...basicDataTypes,
    ...advancedDataTypes
].forEach(registerDataType)

const schemaToJson = (schema: Schema): SchemaFile => {
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

    const ret: Schema = {
        ...pick(schemaFile, ["name", "type"]),
        description: {
            ...pick(schemaFile.description, ["description", "icon"]),
            path: schemaFile.description.path.split("/")
        },
        fields,
        toJson: () => schemaToJson(ret)
    }
    return ret
}

export const generateStructure = (schema: Schema, selector: SelectorStructure): Structure => {
    const fields: Record<string, StructureField> = {}
    const joins: Structure["joins"] = {}

    const table = getTableName(schema)

    schema.fields.forEach(field => {
        const fieldSelector = descendSelector(selector, field.name)

        if (fieldSelector === null)
            return

        const structure = field.type.generateStructure(table, field.name, field.constraints, fieldSelector)

        fields[field.name] = structure.data
        for (const join in structure.joins)
            joins[join] = structure.joins[join]
    })

    return {
        data: {
            type: "object",
            fields
        },
        joins
    }
}