import {z} from "zod";
import {DataSchema, PrimitiveFieldSchema, TypeSchema} from "./schema";

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
        return { type: "string", id: 1 }
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

type MongoSchema = {
    $jsonSchema: object
}

const handleNullable = (isNullable: boolean, value: object) => {
    if (!isNullable) return value

    return { oneOf: [ value, { type: "null" } ] }
}

const primitiveTypeMapping: Record<PrimitiveFieldSchema["type"], string> = {
    string: "string",
    integer: "int",
    float: "double",
    boolean: "bool",
    text: "string",
    datetime: "date"
}

const convertCargoToMongoSchema = (schema: DataSchema): object => {
    const nullable = schema.type === "relation" ? false : schema.nullable ?? false

    const getValue = () => {
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
            case "relation": {
                return { bsonType: "null" }
            }
            default:
                throw new Error(`${schema.type} not supported`)
        }
    }
    return handleNullable(nullable, getValue())
}

export const cargoToMongoSchema = (schema: TypeSchema): MongoSchema => {
    return {
        $jsonSchema: convertCargoToMongoSchema(schema)
    }
}
