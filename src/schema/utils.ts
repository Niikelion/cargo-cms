import {z} from "zod";
import knex from "knex";
import {DataType, FieldConstraints} from "./types";
import {stringifyZodError} from "../utils/errors";
import {TableBuilder} from "../database/types";

export const validatedDataType = <Payload extends NonNullable<FieldConstraints>, PayloadDef extends z.ZodTypeDef>(
    name: string, payloadValidator: z.ZodType<Payload, PayloadDef>,
    generateField: (db: TableBuilder, name: string, data: Payload, table: string) => void,
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
    generateField(builder, name, data, table) {
        generateField(builder, name.replace(".", "_"), data as Payload, table)
    }
} satisfies DataType)

export const singleFieldDataType = <Payload extends NonNullable<FieldConstraints>, PayloadDef extends z.ZodTypeDef>(
    name: string,
    payloadValidator: z.ZodType<Payload, PayloadDef>, builder: (db: TableBuilder, name: string, data: Payload, table: string) => knex.Knex.ColumnBuilder,
    validator?: (data: Payload) => string | null
) =>
    validatedDataType(name, payloadValidator, (tableBuilder, name, data, table) => {
        tableBuilder.useField(name)
        const field = builder(tableBuilder, name, data as Payload, table)

        tableBuilder.useField(name, field)

        if (data.unique)
            field.unique()

        if (data.required)
            field.notNullable()
        else
            field.nullable()
    }, validator)