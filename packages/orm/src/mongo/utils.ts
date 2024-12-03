import {z} from "zod";
import {DataSchema, PrimitiveSchema, TypeSchema} from "../schema";
import {isArray, isCombinedOperationFilter, isNumber, isObject, Json} from "../utils";
import assert from "assert";
import {Condition, Double, Filter, FilterOperations, Int32} from "mongodb";
import {
    CombineOperationFilter,
    ComparisonOperationFilter,
    ComparisonOperationFilterInput,
    FilterType,
    ResponseSelector
} from "../operations";
import {DiscriminatedUnionToTypeMap, mapRecord, mapRecordEntries, typesMapToDiscriminatedUnion} from "@cargo-cms/utils"

const allowedLiteralTypes = [ "number", "string", "boolean" ]

const convertZodToMongoSchema = (schema: z.ZodType): object => {
    if (schema instanceof z.ZodRecord) {
        return {
            type: "object",
            additionalProperties: convertZodToMongoSchema(schema.valueSchema),
            properties: {}
        }
    }
    if (schema instanceof z.ZodObject) {
        const entries = Object.entries(schema.shape)

        return {
            type: "object",
            required: entries.filter(([_, elemSchema]) => !(elemSchema instanceof z.ZodOptional)).map(([key]) => key),
            properties: Object.fromEntries(entries.map(([key, elemSchema]) =>
                [ key, convertZodToMongoSchema(elemSchema instanceof z.ZodOptional ? elemSchema.unwrap() : elemSchema as z.ZodType)]
            ))
        }
    }
    if (schema instanceof z.ZodString) {
        return { type: "string" }
    }
    if (schema instanceof z.ZodNumber) {
        return { type: "number" }
    }
    if (schema instanceof z.ZodBoolean) {
        return { type: "boolean" }
    }
    if (schema instanceof z.ZodNull) {
        return { type: "null" }
    }
    if (schema instanceof z.ZodLiteral) {
        const value = schema.value

        const type = typeof value

        if (!allowedLiteralTypes.includes(type)) throw new Error(`Prohibited literal type: ${type}`)

        return { bsonType: type }
    }
    if (schema instanceof z.ZodUnion) {
        return { anyOf: schema.options.map(convertZodToMongoSchema) }
    }
    if (schema instanceof z.ZodArray) {
        return {
            type: "array",
            items: convertZodToMongoSchema(schema.element)
        }
    }
    if (schema instanceof z.ZodLazy) {
        //a bit of a trick, all lazy instances should reference root in this context
        return { $ref: "/" }
    }

    throw new Error(`${(schema._def as { typeName?: string })["typeName"]} not supported`)
}

export const zodToMongoSchema = (schema: z.ZodType): object => {
    return {
        $jsonSchema: convertZodToMongoSchema(schema),
    }
}

type BsonPrimitiveSchema = {
    bsonType: "string" | "double" | "int" | "bool" | "date" | "null" | "objectId"
}
type BsonArraySchema = {
    bsonType: "array"
    items: BsonSchema
    minItems?: number
    maxItems?: number
}
type BsonObjectSchema = {
    bsonType: "object"
    required?: Array<string>
    properties: Record<string, BsonSchema>
}
type BsonOneOfSchema = {
    oneOf: Array<BsonSchema>
}
type BsonAnyOfSchema = {
    anyOf: Array<BsonSchema>
}
type BsonAllOfSchema = {
    allOf: Array<BsonSchema>
}
type BsonSchema = BsonPrimitiveSchema | BsonArraySchema | BsonObjectSchema | BsonOneOfSchema | BsonAnyOfSchema | BsonAllOfSchema

export type MongoSchema = {
    $jsonSchema: BsonSchema
}

const bsonNullType: BsonPrimitiveSchema = {
    bsonType: "null"
}

const handleNullable = (isNullable: boolean, value: BsonSchema): BsonSchema => {
    if (!isNullable) return value

    return { oneOf: [ value, bsonNullType ] }
}

const primitiveTypeMapping: Record<PrimitiveSchema["type"], BsonPrimitiveSchema["bsonType"]> = {
    string: "string",
    integer: "int",
    float: "double",
    boolean: "bool",
    text: "string",
    datetime: "date"
}

const convertCargoToMongoSchema = (schema: DataSchema): BsonSchema => {
    const nullable = schema.nullable ?? false

    const getValue = (): BsonSchema => {
        switch (schema.type) {
            case "boolean":
            case "integer":
            case "float":
            case "datetime":
            case "text":
            case "string": {
                const additionalProps: Record<string, any> = {}
                if (schema.values !== undefined)
                    additionalProps["enum"] = schema.values

                return {
                    bsonType: primitiveTypeMapping[schema.type],
                    ...additionalProps
                }
            }
            case "pointer": {
                if (schema.multiple) {
                    return {
                        bsonType: "array",
                        items: { bsonType: "int" }
                    }
                }

                return { bsonType: "int" }
            }
            case "object": {
                const entries = Object.entries(schema.fields)
                return {
                    bsonType: "object",
                    properties: Object.fromEntries(entries.map(([fieldName, fieldSchema]) => [fieldName, convertCargoToMongoSchema(fieldSchema)])),
                    required: entries.map(([key]) => key)
                }
            }
            case "array": {
                const additionalProps: Record<string, any> = {}

                if (schema.min !== undefined)
                    additionalProps["minItems"] = schema.min
                if (schema.max !== undefined)
                    additionalProps["maxItems"] = schema.max


                return {
                    bsonType: "array",
                    items: convertCargoToMongoSchema(schema.elements),
                    ...additionalProps
                }
            }
            case "union": {
                const entries = Object.entries(schema.allowedTypes)

                return {
                    oneOf: entries.map(([key, variantSchema]) => ({
                        bsonType: "object",
                        required: [ key ],
                        properties: { [key]: convertCargoToMongoSchema(variantSchema) }
                    }))
                }
            }
        }
    }
    return handleNullable(nullable, getValue())
}

export const cargoToMongoSchema = (schema: TypeSchema): MongoSchema => {
    const entries = Object.entries(schema.fields)
    return {
        $jsonSchema: {
            bsonType: "object",
            required: ["_id", "value"],
            properties: {
                _id: { bsonType: "int" },
                value: {
                    bsonType: "object",
                    properties: Object.fromEntries(entries.map(([fieldName, fieldSchema]) =>
                        [fieldName, fieldSchema.type === "relation" ? undefined : convertCargoToMongoSchema(fieldSchema)]
                    ).filter(([_, v]) => v !== undefined)),
                    required: entries.map(([key]) => key)
                }
            }
        }
    }
}

export const escapeMongoName = (name: string) => name.replace(/\./g, "#")

const isNotRelation = (v: {key: string, value: Json, field: TypeSchema["fields"][string]}): v is {key: string, value: Json, field: DataSchema } => v.field.type !== "relation"

export const toMongoValue = (value: Json, schema: TypeSchema): any => {
    assert.ok(isObject(value))

    const entries = Object.entries(value)
    const fields = entries.map(([key, value]) => ({key, value, field: schema.fields[key]})).filter(isNotRelation)

    const convert = (value: Json, schema: DataSchema): any => {
        switch (schema.type) {
            case "integer": {
                assert.ok(isNumber(value))
                return new Int32(value)
            }
            case "float": {
                assert.ok(isNumber(value))
                return new Double(value)
            }
            case "array": {
                assert.ok(isArray(value))
                return value.map(v => convert(v, schema.elements))
            }
            case "object": {
                assert.ok(isObject(value))
                return Object.fromEntries(Object.entries(value).map(([key, v]) =>
                    [key, convert(v, schema.fields[key])])
                )
            }
            default: return value
        }
    }

    return Object.fromEntries(fields.map(f => [f.key, convert(f.value, f.field)]))
}

export type MongoProjection = 1 | 0 | { [key: string]: MongoProjection }

export const cargoSelectorToMongoProjection = (selector: ResponseSelector, schema: TypeSchema, schemas: Record<string, TypeSchema>): MongoProjection => {
    if (selector === true || selector === 1)
        return mapRecord(schema.fields, _ => 0 as const)

    const convert = (selector: ResponseSelector, schema: DataSchema): MongoProjection => {
        switch (schema.type) {
            case "object": {
                if (selector === true || selector === 1)
                    return mapRecord(schema.fields, _ => 0 as const)

                return mapRecord(schema.fields, (f, k) =>
                    k in selector ? convert(selector[k], f) : 0
                )
            }
            case "array":
                return convert(selector, schema.elements)
            case "union": {
                if (selector === true || selector === 1)
                    return mapRecord(schema.allowedTypes, _ => 0 as const)

                return mapRecord(schema.allowedTypes, (t, k) =>
                    k in selector ? convert(selector[k], t) : 0
                )
            }
            case "text":
            case "string":
            case "integer":
            case "float":
            case "datetime":
            case "boolean": {
                if (selector !== true && selector !== 1) throw new Error("Primitive type have no subfields")
                return 1
            }
            case "pointer":
                return selector === true || selector === 1
                    ? 1
                    : cargoSelectorToMongoProjection(selector, schemas[schema.target], schemas)
        }
    }

    const normalize = (projection: MongoProjection): MongoProjection => {
        if (projection === 0 || projection === 1)
            return projection

        const entries = Object.entries(mapRecord(projection, normalize))

        if (entries.every(v => v[1] !== 0) || entries.every(v => v[1] !== 1))
            return projection

        return Object.fromEntries(entries.filter(v => v[1] !== 0))
    }

    return normalize(mapRecord(schema.fields, (f, k) => {
        if (!(k in selector)) return 0

        return f.type === "relation"
            ? cargoSelectorToMongoProjection(selector[k], schemas[f.target], schemas)
            : convert(selector[k], f);
    }))
}

const convertCargoComparisonFilterToMongoFilter = (filter: Record<string, ComparisonOperationFilterInput>): Record<string, Condition<object>> => {
    return mapRecordEntries(mapRecord(filter, (cond): FilterOperations<object> => {
        const c = typesMapToDiscriminatedUnion<ComparisonOperationFilter>(cond as DiscriminatedUnionToTypeMap<ComparisonOperationFilter>)

        switch (c.type) {
            case "$eq":
            case "$lt":
            case "$lte":
            case "$gt":
            case "$gte":
            case "$in":
                return { [c.type]: c.value }
            case "$neq":
                return { "$ne": c.value }
            case "$null":
                return c.value ? { $eq: null } : { $not: { $eq: null } }
            case "$between":
                return { $gte: c.value[0], $lt: c.value[1] }
            case "$like":
                return { $regex: c.value }
        }
    }), (cond, field) => [`value.${field}`, cond])
}

export const cargoToMongoFilter = (filter: FilterType): Filter<any> => {
    if (isCombinedOperationFilter(filter)) {
        const c = typesMapToDiscriminatedUnion<CombineOperationFilter>(filter as DiscriminatedUnionToTypeMap<CombineOperationFilter>)

        switch (c.type) {
            case "$not": return { $nor: [ cargoToMongoFilter(c.value) ] }
            case "$and": return { $and: c.value.map(cargoToMongoFilter) }
            case "$or":  return { $or: c.value.map(cargoToMongoFilter) }
        }
    } else {
        return convertCargoComparisonFilterToMongoFilter(filter)
    }
}
