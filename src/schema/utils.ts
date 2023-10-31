import {z} from "zod";
import {DataType, FieldConstraints, SelectorStructure, Structure, StructureField} from "./types";
import {stringifyZodError} from "../utils/errors";
import {Field, Table} from "../database/builder";
import {isArray, isBool, isString} from "../utils/filters";

export const validatedDataType = <Payload extends NonNullable<FieldConstraints>, PayloadDef extends z.ZodTypeDef>(
    name: string, payloadValidator: z.ZodType<Payload, PayloadDef>,
    generateColumns: (table: Table<never>, name: string, data: Payload) => Table<string>[] | null,
    generateStructure: (table: string, name: string, data: Payload, selector: SelectorStructure) => Structure,
    verifier?: (data: Payload) => string | null
) => ({
    name,
    verifyData(data: FieldConstraints): string | null {
        const result = payloadValidator.safeParse(data)

        if (!result.success)
            return stringifyZodError(result.error)

        if (verifier)
            return verifier(result.data)

        return null
    },
    generateColumns(table, name, data) {
        return generateColumns(table, name.replace(".", "_"), data as Payload)
    },
    generateStructure(table, name, data, selector) {
        return generateStructure(table, name.replace(".", "_"), data as Payload, selector)
    }
} satisfies DataType)

export const singleFieldDataType = <Payload extends NonNullable<FieldConstraints>, PayloadDef extends z.ZodTypeDef>(
    name: string,
    type: Exclude<StructureField["type"], "array" | "object" | "custom">,
    payloadValidator: z.ZodType<Payload, PayloadDef>,
    builder: (table: Table<never>, name: string, data: Payload) => Field,
    validator?: (data: Payload) => string | null
) =>
    validatedDataType(name, payloadValidator, (table, name, data) => {
        const field = builder(table, name, data as Payload)

        if (data.unique)
            field.unique()

        field.nullable(!(data.required ?? false))

        return null
    }, (table, name): Structure => ({
        data: {type, id: `${table}.${name}`}, joins: {}
    }), validator)

export const nameGenerator = (prefix: string) => function (strings: TemplateStringsArray, ...args: any[]) {
    return `${prefix}_${String.raw({raw: strings}, ...args)}`
}

export const descendSelector = (selector: SelectorStructure, field: string): SelectorStructure | null => {
    if (isBool(selector))
        return null

    if (isString(selector)) {
        if (selector === "*")
            return "*"

        const fields = selector.split(",")
        if (fields.includes(field))
            return true

        return null
    }

    if (isArray(selector)) {
        if (selector.includes(field))
            return {}

        return null
    }

    const f = selector[field]

    if (f === undefined)
        return null

    return f
}