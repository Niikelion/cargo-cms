import {SchemaFile, SchemaFileFieldSchema} from "./reader";
import {Table} from "../database/builder";
import knex from "knex";
import {JSONValue} from "../server/types";

export type FieldConstraints = SchemaField["constraints"]

export type SelectorStructure = string | string[] | true | { [k: string]: SelectorStructure }

type FieldFetcher = (db: knex.Knex, id: number) => [string, knex.Knex.QueryBuilder]

export type StructureField = {
    type: "string" | "number" | "boolean",
    id: string
} | ( {
    type: "array",
    fetch: FieldFetcher
} & Structure) | ({
    type: "object",
    fields: { [K in string]: StructureField }
} & ({
    fetch?: undefined
} | {
    fetch: FieldFetcher
    joins: Record<string, (builder: knex.Knex.QueryBuilder) => void>
})) | {
    type: "custom",
    handler: (db: knex.Knex, id: number) => Promise<JSONValue>
}

export type Structure = {
    data: StructureField
    joins: Record<string, (builder: knex.Knex.QueryBuilder) => void>
}

export type DataType = {
    readonly name: string
    generateColumns: (table: Table<never>, path: string, data: FieldConstraints) => Table<string>[] | null,
    //TODO: maybe pass some uuid generator along the way for unique join aliases in case of multiple joins to the same table in one query
    //TODO: maybe include some blacklist of types to allow downstream generators to avoid infinite looping?
    generateStructure: (table: string, path: string, data: FieldConstraints, selector: SelectorStructure) => Structure
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
    toJson(): SchemaFile
}