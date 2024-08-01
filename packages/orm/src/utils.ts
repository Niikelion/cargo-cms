import {TypesSchema} from "./schema";


import {FilterType, OperationFilterType} from "./operations";

const {applyChangeset, diff} = require("json-diff-ts")

export type Diff = ReturnType<typeof diff>

export function applyDiffToTypeSchema(source: TypesSchema, changes: Diff): TypesSchema {
    const target = applyChangeset(source, changes)

    const parsedTarget = TypesSchema.safeParse(target)

    if (!parsedTarget.success)
        throw new Error("Invalid schema after applying changes")

    return parsedTarget.data
}

export function schemaEquals(source: TypesSchema, target: TypesSchema): boolean {
    return JSON.stringify(source) === JSON.stringify(target)
}

export function diffSchema(source: TypesSchema, target: TypesSchema): boolean {
    return diff(source, target)
}

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

export function isString(v: any): v is string { return typeof v === 'string' || v instanceof String }
export function isNumber(v: any): v is number { return typeof v === 'number' || v instanceof Number }
export function isBoolean(v: any): v is number { return typeof v === 'boolean' || v instanceof Boolean }
export function isArray(v: any): v is any[] { return Array.isArray(v) || v instanceof Array }
export function isObject(v: Json): v is { [k: string]: Json } { return !isString(v) && !isNumber(v) && !isBoolean(v) && !isArray(v) }

export const FilterOperations = [
    "$not",
    "$and",
    "$or",
    "$eq",
    "$neq",
    "$lt",
    "$lte",
    "$gt",
    "$gte",
    "$like",
    "$null",
    "$in",
    "$between"
] as const

export function isOperationFilter(v: FilterType): v is OperationFilterType {
    if (!isObject(v)) return false

    const keys = Object.keys(v)

    if (keys.length !== 1) return false

    const [key] = keys
    return FilterOperations.includes(key as typeof FilterOperations[number])
}
