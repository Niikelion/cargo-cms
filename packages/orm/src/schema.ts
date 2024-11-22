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

export const PrimitiveSchema = GenericProperties.extend({
    type: FieldType,
    values: PrimitiveType.array().optional()
})
export type PrimitiveSchema = z.infer<typeof PrimitiveSchema>

const RelationFieldSchemaBase = z.object({
    type: z.literal("relation"),
    target: z.string(),
    toMultiple: z.boolean() // describes whether we expect other end to have multiple entries
})

export const RelationSchema = z.union([
    RelationFieldSchemaBase.extend({
        bidirectional: z.literal(false)
    }),
    RelationFieldSchemaBase.extend({
        bidirectional: z.literal(true),
        targetField: z.object({
            toMultiple: z.boolean(), // describes whether other end expects us to have multiple entries
            path: z.string()
        })
    })
])
export type RelationSchema = z.infer<typeof RelationSchema>

export const ArraySchema: z.ZodType<ArraySchema> = GenericProperties.extend({
    type: z.literal("array"),
    elements: z.lazy(() => DataSchema),
    min: z.number().optional(),
    max: z.number().optional()
})
export type ArraySchema = {
    type: "array",
    elements: DataSchema
    min?: number
    max?: number
} & GenericProperties

export const ObjectSchema: z.ZodType<ObjectSchema> = GenericProperties.extend({
    type: z.literal("object"),
    fields: z.record(z.string(), z.lazy(() => DataSchema))
})
export type ObjectSchema = {
    type: "object",
    fields: Record<string, DataSchema>
} & GenericProperties

export const UnionSchema: z.ZodType<UnionSchema> = GenericProperties.extend({
    type: z.literal("union"),
    allowedTypes: z.lazy(() => DataSchema.array())
})
export type UnionSchema = {
    type: "union",
    allowedTypes: DataSchema[]
} & GenericProperties

export const DataSchema = z.union([
    PrimitiveSchema, ArraySchema, ObjectSchema, UnionSchema
])
export type DataSchema = z.infer<typeof DataSchema>

export const TypeSchema: z.ZodType<TypeSchema> = z.object({
    name: z.string(),
    type: z.literal("object"),
    fields: z.record(z.string(), z.union([DataSchema, RelationSchema]))
})
export type TypeSchema = Pick<ObjectSchema, "type"> & {
    name: string
    fields: Record<string, DataSchema | RelationSchema>
}
export const TypesSchema = z.record(z.string(), TypeSchema)
export type TypesSchema = z.infer<typeof TypesSchema>
