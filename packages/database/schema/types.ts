import {Table} from "../types";
import {Knex} from "knex";
import {JSONValue} from "@cargo-cms/utils/types";

export type FieldConstraints = SchemaField["constraints"]

export type SelectorStructure = string | (string | { [k: string]: SelectorStructure })[] | true | { [k: string]: SelectorStructure }

export type PrimitiveType = string | number | boolean | null
export type NestedRecord = { [k: string]: NestedRecord | PrimitiveType }

export type FilterType = { [k: string]: FilterType[] | { [k: string]: PrimitiveType | [number, number] | string[] } }
export type SortType = { field: string, desc?: boolean } | string

export type FieldFetcher = {
    table: string,
    query: (db: Knex, id: number) => Knex.QueryBuilder
}

export type TableJoin = {
    table: string,
    build: (builder: Knex.QueryBuilder) => void
}

export type StructureField = {
    type: "string" | "number" | "boolean",
    id: string
} | ( {
    type: "array",
    fetch: FieldFetcher
    upload: { table: string, getLinkData: (id: number, index: number, value: JSONValue) => Record<string, PrimitiveType> } | ((db: Knex, id: number, index: number, value: JSONValue) => Promise<void>)
} & Structure) | ({
    type: "object",
    fields: { [K in string]: StructureField }
    upload?: {
        type: "inwards"
        table: string,
        getLinkData: (id: number, value: JSONValue) => Record<string, PrimitiveType>
    } | {
        type: "outwards"
        getLinkData: (value: JSONValue) => Record<string, PrimitiveType>
    } | {
        type: "custom"
        upload: (db: Knex, id: number, value: JSONValue) => Promise<void>
    }
} & ({
    fetch?: undefined
} | {
    fetch: FieldFetcher
    joins: Record<string, TableJoin>
})) | {
    type: "custom",
    fetch: (db: Knex, id: number) => Promise<JSONValue>
    upload: (db: Knex, id: number, value: JSONValue) => Promise<void>
}

export type Structure = {
    data: StructureField
    joins: Record<string, TableJoin>
}

export type StructureGeneratorArgs = {
    table: string,
    path: string,
    data: FieldConstraints,
    selector: SelectorStructure,
    usedTypes: Set<string>,
    uuidGenerator: () => string
}

export type GenerateColumnsConfig = {
    depth: number
}

export type DataType = {
    readonly name: string
    generateColumns: (table: Table<never>, path: string, data: FieldConstraints, config?: GenerateColumnsConfig) => Table<string>[] | null,
    generateStructure: (ags: StructureGeneratorArgs) => Structure
    verifyData: (data: FieldConstraints) => string | null
}

export type SchemaField = {
    name: string
    constraints: {
        unique?: boolean
        required?: boolean
        [x: string]: unknown
    }
    description: {
        visible: boolean
        path: string[]
        description?: string
        order?: number
    },
    type: DataType
}

export type Schema = {
    name: string
    type: "entity" | "component"
    description: {
        path: string[]
        icon?: string
        description?: string
    }
    fields: SchemaField[]
}