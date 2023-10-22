import {z} from "zod";
import {fieldConstraintsSchema} from "./reader";
import {isDefined} from "../utils/filters";
import {singleFieldDataType} from "./utils";
import {ColumnBuilder} from "../database/types";

const nameGenerator = (prefix: string) => function (strings: TemplateStringsArray, ...args: any[]) {
    return `${prefix}_${String.raw({raw: strings}, ...args)}`
}

const stringDataPayload = fieldConstraintsSchema.extend({
    max: z.number().optional(),
    min: z.number().optional(),
    regex: z.string().optional()
})

const addStringChecks = (field: ColumnBuilder, name: string, data: z.infer<typeof stringDataPayload>) => {
    const c = nameGenerator(name)

    if (isDefined(data.max))
        field.checkLength('<=', data.max, c`max_length`)

    if (isDefined(data.min))
        field.checkLength('>=', data.min, c`min_length`)

    if (isDefined(data.regex))
        field.checkRegex(data.regex, c`regex`)
}

const shortTextDataType = singleFieldDataType("shortText", stringDataPayload, (builder, name, data) => {
    const field = builder.string(name)
    addStringChecks(field, name, data)
    return field
})

const longTextDataType = singleFieldDataType("longText", stringDataPayload, (builder, name, data) => {
    const field = builder.text(name)
    addStringChecks(field, name, data)
    return field
})

const numberDataPayload = fieldConstraintsSchema.extend({
    max: z.number().optional(),
    min: z.number().optional()
})

const addNumberChecks = (field: ColumnBuilder, name: string, data: z.infer<typeof numberDataPayload>) => {
    const c = nameGenerator(name)

    if (isDefined(data.max) && isDefined(data.min))
        field.checkBetween([data.min, data.max], c`range`)
}

const integerDataType = singleFieldDataType("integer", numberDataPayload, (builder, name, data) => {
    const field = builder.integer(name)
    addNumberChecks(field, name, data)
    return field
})

const floatDataType = singleFieldDataType("float", numberDataPayload, (builder, name, data) => {
    const field = builder.float(name)
    addNumberChecks(field, name, data)
    return field
})

const doubleDataType = singleFieldDataType("double", numberDataPayload, (builder, name, data) => {
    const field = builder.double(name)
    addNumberChecks(field, name, data)
    return field
})

const booleanDataType = singleFieldDataType("boolean", fieldConstraintsSchema, (builder, name) =>
    builder.boolean(name))

export const basicDataTypes = [
    longTextDataType,
    shortTextDataType,
    integerDataType,
    floatDataType,
    doubleDataType,
    booleanDataType
]