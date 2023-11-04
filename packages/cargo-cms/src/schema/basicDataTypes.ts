import {z} from "zod";
import {fieldConstraintsSchema} from "./reader";
import {isDefined} from "@cargo-cms/utils/filters";
import {singleFieldDataType} from "@cargo-cms/database/schema/utils";
import {NumericField, TextField} from "@cargo-cms/database";

const stringDataPayload = fieldConstraintsSchema.extend({
    max: z.number().optional(),
    min: z.number().optional(),
    regex: z.string().optional()
})

const addStringChecks = (field: TextField, name: string, data: z.infer<typeof stringDataPayload>) => {
    if (isDefined(data.max))
        field.length("le", data.max)

    if (isDefined(data.min))
        field.length("ge", data.min)

    if (isDefined(data.regex))
        field.regex(data.regex)
}

const shortTextDataType = singleFieldDataType("shortText", "string", stringDataPayload, (table, name, data) =>
    table.string(name, c => addStringChecks(c, name, data)).fields[name])

const longTextDataType = singleFieldDataType("longText", "string", stringDataPayload, (table, name, data) =>
    table.text(name, c => addStringChecks(c, name, data)).fields[name])

const numberDataPayload = fieldConstraintsSchema.extend({
    max: z.number().optional(),
    min: z.number().optional()
})

const addNumberChecks = (field: NumericField, name: string, data: z.infer<typeof numberDataPayload>) => {
    if (isDefined(data.max) && isDefined(data.min))
        field.inRange(data.min, data.max)
}

const integerDataType = singleFieldDataType("integer", "number", numberDataPayload, (table, name, data) =>
    table.int(name, c => addNumberChecks(c, name, data)).fields[name])

const floatDataType = singleFieldDataType("float", "number", numberDataPayload, (table, name, data) =>
    table.float(name, c => addNumberChecks(c, name, data)).fields[name])

const doubleDataType = singleFieldDataType("double", "number", numberDataPayload, (table, name, data) =>
    table.double(name, c => addNumberChecks(c, name, data)).fields[name])

const booleanDataType = singleFieldDataType("boolean", "number", fieldConstraintsSchema, (table, name) =>
    table.bool(name).fields[name])

export const basicDataTypes = [
    longTextDataType,
    shortTextDataType,
    integerDataType,
    floatDataType,
    doubleDataType,
    booleanDataType
]