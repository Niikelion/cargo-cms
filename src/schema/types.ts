import {SchemaFile, SchemaFileFieldSchema} from "./reader";
import {TableBuilder} from "../database/types";

export type FieldConstraints = SchemaField["constraints"]

export type DataType = {
    readonly name: string
    generateField: (builder: TableBuilder, path: string, data: FieldConstraints, table: string) => void,
    verifyData: (data: FieldConstraints) => string | null
}

export type SchemaField = Pick<SchemaFileFieldSchema, "name" | "constraints"> & {
    description: Pick<SchemaFileFieldSchema["description"], "description" | "order" | "visible"> & {
        path: string[]
    },
    type: DataType
}

export type Schema = Pick<SchemaFile, "name" | "type"> & {
    description: Pick<SchemaFile["description"], "icon" | "description"> & {
        path: string[]
    }
    fields: SchemaField[]
}