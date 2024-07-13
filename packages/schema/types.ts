export type FieldType = "integer" | "double" | "boolean" | "string" | "text"

type PrimitiveType = number | string | boolean

export type PrimitiveFieldSchema = {
    type: FieldType
    values?: PrimitiveType[]
}

export type RelationFieldSchema = {
    type: "relation",
    target: string
    multiple: boolean
} & ({
    bidirectional: false
} | {
    bidirectional: true
    targetField: {
        multiple: boolean
        name: string
    }
})

export type FieldSchema = PrimitiveFieldSchema | RelationFieldSchema

export type ArraySchema = {
    type: "array",
    elements: DataSchema
    min?: number
    max?: number
}

export type ObjectSchema = {
    type: "object",
    fields: Record<string, DataSchema>
}

export type DataSchema = FieldSchema | ArraySchema | ObjectSchema
export type TypeSchema = ObjectSchema & { name: string }

export type DatabaseDriver = {
    applySchema(types: Record<string, TypeSchema>): Promise<void>

    close(): Promise<void>
}