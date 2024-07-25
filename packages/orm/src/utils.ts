const {applyChangeset, diff} = require("json-diff-ts")
import {Diff, TypesSchema} from "./types"

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
