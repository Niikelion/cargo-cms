import {z} from "zod"
const {diff} = require("json-diff-ts")

export const FieldType = z.union([
    z.literal("integer"),
    z.literal("double"),
    z.literal("boolean"),
    z.literal("string"),
    z.literal("text"),
    z.literal("datetime")
])
export type FieldType = z.infer<typeof FieldType>

const PrimitiveType = z.union([z.number(), z.string(), z.boolean()])

export const GenericProperties = z.object({
    unique: z.boolean(),
    nullable: z.boolean()
}).partial()
export type GenericProperties = z.infer<typeof GenericProperties>

export const PrimitiveFieldSchema = z.intersection(z.object({
    type: FieldType,
    values: PrimitiveType.array().optional()
}), GenericProperties)
export type PrimitiveFieldSchema = z.infer<typeof PrimitiveFieldSchema>

export const RelationFieldSchema = z.intersection(z.object({
    type: z.literal("relation"),
    target: z.string(),
    multiple: z.boolean()
}), z.union([
    z.object({
        bidirectional: z.literal(false),
    }),
    z.object({
        bidirectional: z.literal(true),
        targetField: z.object({
            multiple: z.boolean(),
            path: z.string()
        })
    })
]))
export type RelationFieldSchema = z.infer<typeof RelationFieldSchema>

export const FieldSchema = z.intersection(GenericProperties, z.union([
    PrimitiveFieldSchema,
    RelationFieldSchema
]))
export type FieldSchema = z.infer<typeof FieldSchema>

export const ArraySchema: z.ZodType<ArraySchema> = z.intersection(z.object({
    type: z.literal("array"),
    elements: z.lazy(() => DataSchema),
    min: z.number().optional(),
    max: z.number().optional()
}), GenericProperties)
export type ArraySchema = {
    type: "array",
    elements: DataSchema
    min?: number
    max?: number
} & GenericProperties

export const ObjectSchema: z.ZodType<ObjectSchema> = z.intersection(z.object({
    type: z.literal("object"),
    fields: z.record(z.string(), z.lazy(() => DataSchema))
}), GenericProperties)
export type ObjectSchema = {
    type: "object",
    fields: Record<string, DataSchema>
} & GenericProperties

export const DataSchema = z.union([
    FieldSchema, ArraySchema, ObjectSchema
])
export type DataSchema = z.infer<typeof DataSchema>
export const TypeSchema: z.ZodType<TypeSchema> = z.object({
    name: z.string(),
    type: z.literal("object"),
    fields: z.record(z.string(), DataSchema)
})
export type TypeSchema = Pick<ObjectSchema, "type" | "fields"> & { name: string }

export type Diff = ReturnType<typeof diff>

export const TypesSchema = z.record(z.string(), TypeSchema)
export type TypesSchema = z.infer<typeof TypesSchema>

export type PrimitiveType = string | number | boolean | null

//export type ResponseSelector = true | string | { [k: string]: ResponseSelector } | (string | { [k: string]: ResponseSelector })[]
export type ResponseSelector = true | { [k: string]: ResponseSelector }
export type FilterType = { [k: string]: FilterType[] | { [k: string]: PrimitiveType | [number, number] | string[] } }
export type SortType = { field: string, desc?: boolean } | string

export type QueryOptions = {
    selector: ResponseSelector
    filter?: FilterType
    sort?: SortType
    limit?: number
}

export type DatabaseDriver = {
    /**
     * Performs database integrity check.
     * Looks for things like missing fields and unsatisfied constraints.
     */
    performIntegrityCheck(): Promise<void>
    /**
     * Initializes database connection and initializes driver.
     */
    init(): Promise<void>
    /**
     * End database connection and performs cleanup.
     */
    close(): Promise<void>
    /**
     * Applies new schema, overriding previous one.
     * @param types
     */
    applySchema(types: TypesSchema): Promise<void>
    /**
     * Applies changes to existing schema.
     * @param changes
     */
    applySchemaDelta(changes: Diff): Promise<void>
    /**
     * Retrieves current schema applied to the database.
     */
    getCurrentSchema(): Promise<TypesSchema>

    /**
     * Queries database with given options.
     * @param entityName
     * @param options
     */
    query(entityName: string, options: QueryOptions): Promise<object>
}

