import {z} from "zod";
import {DataType, FieldConstraints, Structure, StructureField} from "./types";
import {stringifyZodError} from "../utils/errors";
import {Field, Table} from "../database/builder";

export const validatedDataType = <Payload extends NonNullable<FieldConstraints>, PayloadDef extends z.ZodTypeDef>(
    name: string, payloadValidator: z.ZodType<Payload, PayloadDef>,
    generateColumns: (table: Table<never>, name: string, data: Payload) => Table<string>[] | null,
    generateStructure: (table: Table<never>, name: string, data: Payload) => Structure,
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
    generateStructure(table, name, data) {
        return generateStructure(table, name.replace(".", "_"), data as Payload)
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
    }, (table, name): Structure => {
        return {
            data: { type, id: `${table.name}.${name}` }, joins: {}
        }
    }, validator)

export const nameGenerator = (prefix: string) => function (strings: TemplateStringsArray, ...args: any[]) {
    return `${prefix}_${String.raw({raw: strings}, ...args)}`
}