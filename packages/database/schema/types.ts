import {Table} from "../types";
import knex from "knex";
import {JSONValue} from "@cargo-cms/utils/types";

export type FieldConstraints = SchemaField["constraints"]

export type SelectorStructure = string | (string | { [k: string]: SelectorStructure })[] | true | { [k: string]: SelectorStructure }

export type PrimitiveType = string | number | boolean | null
export type NestedRecord = { [k: string]: NestedRecord | PrimitiveType }

export type FilterType = { [k: string]: FilterType[] | { [k: string]: PrimitiveType | [number, number] | string[] } }
export type OrderType = { field: string, desc?: boolean } | string

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

export type StructureGeneratorArgs = {
    table: string,
    path: string,
    data: FieldConstraints,
    selector: SelectorStructure,
    usedTypes: Set<string>,
    uuidGenerator: () => string
}

export type DataType = {
    readonly name: string
    //TODO: add depth limit to the field generation
    generateColumns: (table: Table<never>, path: string, data: FieldConstraints) => Table<string>[] | null,
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