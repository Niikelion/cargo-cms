import {Schema, SchemaField, DataType} from "@cargo-cms/database/schema";
import {SchemaFile, SchemaFileFieldSchema} from "./reader";
import {pick} from "@cargo-cms/utils/objects";
import {makeModule} from "@cargo-cms/module-core";
import {TypeRegistryModule} from "../type-registry";

const data = {
    getDataType: (_: string): DataType | null => null,
    fromJson(schemaFile: SchemaFile): Schema {
        const fields = schemaFile.fields.map(rawField => {
            const type = data.getDataType(rawField.type)

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
    },
    toJson(schema: Schema): SchemaFile {
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
}

const schemaLoader = makeModule("schema-loader", {
    async init(ctx) {
        const typeRegistry = await ctx.require<TypeRegistryModule>("type-registry")
        data.getDataType = typeRegistry.getDataType
    }
}, data)

export default schemaLoader