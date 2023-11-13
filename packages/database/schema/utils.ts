import {z} from "zod";
import {
    DataType,
    FieldConstraints, NestedRecord, PrimitiveType,
    Schema,
    SelectorStructure,
    Structure,
    StructureField, StructureGeneratorArgs
} from "@cargo-cms/database/schema";
import {stringifyZodError} from "@cargo-cms/utils/errors";
import {isArray, isBool, isDefined, isNumber, isString} from "@cargo-cms/utils/filters";
import {Field, Table} from "@cargo-cms/database";
import {JSONValue} from "@cargo-cms/utils/types";
import assert from "assert";

export const getTableName = (schema: Schema) => schema.name.replace(".", "_")

export const validatedDataType = <Payload extends NonNullable<FieldConstraints>, PayloadDef extends z.ZodTypeDef>(
    name: string, payloadValidator: z.ZodType<Payload, PayloadDef>,
    generateColumns: (table: Table<never>, path: string, data: Payload) => Table<string>[] | null,
    generateStructure: (args: Omit<StructureGeneratorArgs, "data"> & { data: Payload }) => Structure,
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
    generateColumns(table, path, data) {
        return generateColumns(table, path.replace(".", "_"), data as Payload)
    },
    generateStructure(args) {
        const { data, path, ...rest} = args

        return generateStructure({...rest, data: data as Payload, path: path.replace(".", "_")})
    }
} satisfies DataType)

export const singleFieldDataType = <Payload extends NonNullable<FieldConstraints>, PayloadDef extends z.ZodTypeDef>(
    name: string,
    type: Exclude<StructureField["type"], "array" | "object" | "custom">,
    payloadValidator: z.ZodType<Payload, PayloadDef>,
    builder: (table: Table<never>, name: string, data: Payload) => Field,
    validator?: (data: Payload) => string | null
) =>
    validatedDataType(name, payloadValidator, (table, path, data) => {
        const field = builder(table, path, data as Payload)

        if (data.unique)
            field.unique()

        field.nullable(!(data.required ?? false))

        return null
    }, ({table, path}): Structure => ({
        data: {type, id: `${table}.${path}`}, joins: {}
    }), validator)

export const descendSelector = (selector: SelectorStructure, field: string): SelectorStructure | null => {
    if (isBool(selector))
        return null

    if (isString(selector)) {
        if (selector === "**")
            return "**"

        if (selector === "*")
            return true

        const fields = selector.split(",")
        if (fields.includes(field))
            return true

        return null
    }

    if (isArray(selector)) {
        return selector.reduce((acc: SelectorStructure | null, element) => {
            const result = descendSelector(element, field)

            if (result === null || acc === null)
                return acc ?? result

            if (result === "**" || acc === "**")
                return "**"

            if (acc === true)
                return result

            return acc
        }, null)
    }

    const f = selector[field]

    if (f === undefined)
        return null

    return f
}

const makeUuidGenerator = () => {
    let i = 0;
    return () => `t${++i}`
}

export const generateStructure = (schema: Schema, selector: SelectorStructure, args?: {
    uuidGenerator?: () => string
    tableName?: string
}): Structure => {
    const fields: Record<string, StructureField> = {}
    const joins: Structure["joins"] = {}

    args ??= {}

    const table = args.tableName ?? getTableName(schema)

    const uuidGenerator = args.uuidGenerator ?? makeUuidGenerator()

    schema.fields.forEach(field => {
        const fieldSelector = descendSelector(selector, field.name)

        if (fieldSelector === null)
            return

        const structure = field.type.generateStructure({
            table,
            path: field.name,
            data: field.constraints,
            selector: fieldSelector,
            usedTypes: new Set<string>(),
            uuidGenerator
        })

        fields[field.name] = structure.data
        for (const join in structure.joins)
            joins[join] = structure.joins[join]
    })

    return {
        data: {
            type: "object",
            fields
        },
        joins
    } satisfies Structure
}

export const unFlattenStructure = (source: Record<string, PrimitiveType>): NestedRecord => {
    const ret: NestedRecord = {}

    for (const prop in source) {
        const path = prop.split("/")
        const end = path.pop()

        assert(end !== undefined)

        let root: Record<string, JSONValue> = ret
        path.forEach(part => {
            root[part] ??= {}

            const next = root[part]
            assert(isDefined(next))

            assert(!(isNumber(next) || isString(next) || isBool(next) || isArray(next)))

            root = next
        })

        root[end] = source[prop]
    }

    return ret
}

export const flattenStructure = (source: NestedRecord): Record<string, PrimitiveType> => {
    const ret: Record<string, PrimitiveType> = {}

    const extract = (source: NestedRecord, path?: string) => {
        for (const prop in source) {
            const v = source[prop]

            const p = path !== undefined ? `${path}/${prop}` : prop

            if (v === null || isString(v) || isBool(v) || isNumber(v)) {
                ret[p] = v
                continue
            }

            extract(v, p)
        }
    }

    extract(source)

    return ret
}