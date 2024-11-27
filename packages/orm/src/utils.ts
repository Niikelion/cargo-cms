import {TypesSchema} from "./schema";


import {FilterType, CombineOperationFilterInput} from "./operations";

const {applyChangeset, diff} = require("json-diff-ts")

export type Diff = ReturnType<typeof diff>

export function applyDiffToTypeSchema(source: TypesSchema, changes: Diff): TypesSchema {
    const target = applyChangeset(structuredClone(source), changes)

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

export type JsonObject = { [k: string]: Json }
export type JsonArray = Json[]
export type JsonValue = string | number | boolean | null
export type Json = JsonValue | JsonArray | JsonObject

export function isString(v: any): v is string { return typeof v === 'string' || v instanceof String }
export function isNumber(v: any): v is number { return typeof v === 'number' || v instanceof Number }
export function isBoolean(v: any): v is number { return typeof v === 'boolean' || v instanceof Boolean }
export function isArray(v: any): v is any[] { return Array.isArray(v) || v instanceof Array }
export function isObject(v: Json): v is { [k: string]: Json } { return !isString(v) && !isNumber(v) && !isBoolean(v) && !isArray(v) }

export const CombineFilterOperations = [
    "$not",
    "$and",
    "$or"
] as const

export function isCombinedOperationFilter(v: FilterType): v is CombineOperationFilterInput {
    if (!isObject(v)) return false

    const keys = Object.keys(v)

    if (keys.length !== 1) return false

    const [key] = keys
    return CombineFilterOperations.includes(key as typeof CombineFilterOperations[number])
}
