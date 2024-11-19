import {z} from "zod";

export const FieldType = z.union([
    z.literal("integer"),
    z.literal("float"),
    z.literal("boolean"),
    z.literal("string"),
    z.literal("text"),
    z.literal("datetime")
])
export type FieldType = z.infer<typeof FieldType>

export const PrimitiveType = z.union([z.number(), z.string(), z.boolean(), z.null()])
export type PrimitiveType = z.infer<typeof PrimitiveType>

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
    toMultiple: z.boolean() // describes whether we expect other end to have multiple entries
}), z.union([
    z.object({
        bidirectional: z.literal(false),
    }),
    z.object({
        bidirectional: z.literal(true),
        targetField: z.object({
            toMultiple: z.boolean(), // describes whether other end expects us to have multiple entries
            path: z.string()
        })
    })
]))
export type RelationFieldSchema = z.infer<typeof RelationFieldSchema>

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

export const UnionSchema: z.ZodType<UnionSchema> = z.intersection(z.object({
    type: z.literal("union"),
    allowedTypes: z.lazy(() => DataSchema.array())
}), GenericProperties)
export type UnionSchema = {
    type: "union",
    allowedTypes: DataSchema[]
} & GenericProperties

export const DataSchema = z.union([
    PrimitiveFieldSchema, RelationFieldSchema, ArraySchema, ObjectSchema, UnionSchema
])
export type DataSchema = z.infer<typeof DataSchema>

export const TypeSchema: z.ZodType<TypeSchema> = z.object({
    name: z.string(),
    type: z.literal("object"),
    fields: z.record(z.string(), DataSchema)
})
export type TypeSchema = Pick<ObjectSchema, "type" | "fields"> & { name: string }
export const TypesSchema = z.record(z.string(), TypeSchema)
export type TypesSchema = z.infer<typeof TypesSchema>
