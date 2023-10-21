import {DataType, FieldConstraints} from "./types";
import {z} from "zod";
import {fieldConstraintsSchema} from "./reader";
import {stringifyZodError} from "../utils/errors";
import knex from "knex";
import {isDefined} from "../utils/filters";

const stringDataPayload = fieldConstraintsSchema.extend({
    max: z.number().optional(),
    min: z.number().optional(),
    regex: z.string().optional()
}).optional()

type StringDataPayload = z.infer<typeof stringDataPayload>

const stringDataType = {
    name: "string",
    verifyData(data: FieldConstraints): string | null {
        const result = stringDataPayload.safeParse(data)

        return result.success ? null : stringifyZodError(result.error)
    },
    generateField(builder: knex.Knex.CreateTableBuilder, name: string, data: StringDataPayload): void {
        const field = builder.string(name.replace(".", "_"))

        data ??= {}

        if (data.unique) {
            field.unique()
        }

        if (isDefined(data.max)) {
            field.
        }
    }
} satisfies DataType

export const basicDataTypes = [
    stringDataType
]