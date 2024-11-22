import {z} from "zod";
import {DataSchema, PrimitiveSchema, TypeSchema} from "../schema";
import {isArray, isNumber, isObject, Json} from "../utils";
import assert from "assert";
import {Double, Int32} from "mongodb";

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
    bsonType: "string" | "double" | "int" | "bool" | "date" | "null"
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
            default:
                throw new Error(`${schema.type} not supported`)
        }
    }
    return handleNullable(nullable, getValue())
}

export const cargoToMongoSchema = (schema: TypeSchema): MongoSchema => {
    const fields: TypeSchema["fields"] = {
        ...schema.fields,
        __id: {
            type: "integer",
            unique: true,
            nullable: false
        }
    }

    const entries = Object.entries(fields)
    return {
        $jsonSchema: {
            bsonType: "object",
            required: ["__id", "value"],
            properties: {
                __id: {
                    bsonType: "int"
                },
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

const convertToMongoValue = (value: Json, schema: DataSchema): any => {
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
            return value.map(v => convertToMongoValue(v, schema.elements))
        }
        case "object": {
            assert.ok(isObject(value))
            return Object.fromEntries(Object.entries(value).map(([key, v]) =>
                [key, convertToMongoValue(v, schema.fields[key])])
            )
        }
        default: return value
    }
}

const isNotRelation = (v: {key: string, value: Json, field: TypeSchema["fields"][string]}): v is {key: string, value: Json, field: DataSchema } => v.field.type !== "relation"

export const toMongoValue = (value: Json, schema: TypeSchema): any => {
    assert.ok(isObject(value))

    const entries = Object.entries(value)
    const fields = entries.map(([key, value]) => ({key, value, field: schema.fields[key]})).filter(isNotRelation)

    return Object.fromEntries(fields.map(f => [f.key, convertToMongoValue(f.value, f.field)]))
}
