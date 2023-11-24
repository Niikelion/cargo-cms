import {FieldFetcher, FilterType, SelectorStructure, SortType, Structure, StructureField} from "./schema";
import {Knex} from "knex";
import {isArray, isDefined, isString} from "@cargo-cms/utils/filters";
import {JSONValue} from "@cargo-cms/utils/types";

type ObjWithUpload = StructureField & { type: "object" } & Required<Pick<StructureField & {type: "object"}, "upload">>

type ExtractHandlers = {
    onCustomObject?: (path: string, obj: StructureField & { type: "object", fetch: FieldFetcher }) => void
    onCustomObjectUpload?: (path: string, obj: ObjWithUpload) => void
    onArray?: (path: string, array: StructureField & { type: "array" }) => void
    onCustom?: (path: string, custom: StructureField & { type: "custom" }) => void
}

export type Fields = Record<string, string>
export type Joins = [string, Structure["joins"][string]][]

export const extractDataFromStructure = (structure: Structure, handlers?: ExtractHandlers) => {
    const fields: Fields = {}
    const joins: Joins = []

    handlers ??= {}

    Object.entries(structure.joins).forEach(join => joins.push(join))

    const extractData = (path: string, s: StructureField) => {
        switch (s.type) {
            case "string": case "number": case "boolean": fields[path] = s.id; break
            case "object": {
                if (s.upload !== undefined)
                    if (handlers?.onCustomObjectUpload)
                        handlers.onCustomObjectUpload(path, s as ObjWithUpload)

                if (s.fetch !== undefined) {
                    if (handlers?.onCustomObject)
                        handlers.onCustomObject(path, s)
                    break
                }

                Object.entries(s.fields).forEach(([name, field]) => {
                    extractData(path.length > 0 ? `${path}.${name}` : name, field)
                })
                break
            }
            case "array": {
                if (handlers?.onArray)
                    handlers.onArray(path, s)
                break
            }
            case "custom": {
                if (handlers?.onCustom)
                    handlers.onCustom(path, s)
                break
            }
        }
    }

    extractData("", structure.data)

    return {
        fields,
        joins
    }
}

export const applyJoins = (query: Knex.QueryBuilder, joins: Joins): void => {
    joins.forEach(([_, join]) => join.build(query))
}

export const applyFields = (db: Knex, query: Knex.QueryBuilder, fields: Fields) => {
    Object.entries(fields).forEach(([path, id]) => query.select(db.raw('?? as ??', [id, path.replace(".", "/")])))
}

type Q = Knex.QueryBuilder
type CF = (q: Q) => void

const filterCombiners = {
    "!and": (q: Q, f: CF) => q.andWhere(f),
    "!or": (q: Q, f: CF) => q.orWhere(f),
    "!not": (q: Q, f: CF) => q.whereNot(f)
} as const
type FilterCombinerName = keyof typeof filterCombiners
const supportedFilterCombiners = Object.keys(filterCombiners) as FilterCombinerName[]
const isFilterCombinerName = (v: string): v is FilterCombinerName => supportedFilterCombiners.includes(v as FilterCombinerName)

const filterComparers = {
    "!eq": (q: Q, p: string, v: JSONValue) => q.where(p, "=", v),
    "!neq": (q: Q, p: string, v: JSONValue) => q.where(p, "<>", v),
    "!null": (q: Q, p: string, _: JSONValue) => q.whereNull(p),
    "!notNull": (q: Q, p: string, _: JSONValue) => q.whereNotNull(p),
    "!lt": (q: Q, p: string, v: JSONValue) => q.where(p, "<", v),
    "!lte": (q: Q, p: string, v: JSONValue) => q.where(p, "<=", v),
    "!gt": (q: Q, p: string, v: JSONValue) => q.where(p, ">", v),
    "!ge": (q: Q, p: string, v: JSONValue) => q.where(p, ">=", v),
    "!like": (q: Q, p: string, v: JSONValue) => q.whereLike(p, v),
    "!in": (q: Q, p: string, v: JSONValue) => q.whereIn([p], [v as string[]]),
    "!between": (q: Q, p: string, v: JSONValue) => q.whereBetween(p, v as [number, number])
} as const
type FilterComparerName = keyof typeof filterComparers
const supportedFilterComparers = Object.keys(filterComparers) as FilterComparerName[]
const isFilterComparerName = (v: string): v is FilterComparerName => supportedFilterComparers.includes(v as FilterComparerName)

export const generateSelectorFromFilter = (filter: FilterType): SelectorStructure => {
    const paths: string[] = []

    const extractPaths = (filter: FilterType): void => {
        for (const prop in filter) {
            const v = filter[prop]

            if (isArray(v)) {
                if (!isFilterCombinerName(prop))
                    continue

                v.forEach(extractPaths)
            }

            for (const op in v) {
                if (!isFilterComparerName(op))
                    continue

                paths.push(prop)
            }
        }
    }

    extractPaths(filter)

    type NarrowSelector = { [k: string]: NarrowSelector }

    let selector: NarrowSelector = {}

    for (const path of paths) {
        const parts = path.split(".")

        let c: NarrowSelector = selector

        for (const part of parts) {
            c = c[part] ??= {}
        }
    }

    return selector
}

export const applyFilters = (query: Knex.QueryBuilder, filter: FilterType, fields: Fields): void => {
    for (const prop in filter) {
        const v = filter[prop]

        if (isArray(v)) {
            if (!isFilterCombinerName(prop))
                continue

            const combine = filterCombiners[prop]

            v.forEach((v, i) => {
                const innerFilter = (q: Q) => applyFilters(q, v, fields)

                if (i === 0) {
                    query.where(innerFilter);
                    return
                }

                combine(query, innerFilter)
            })

            continue
        }

        for (const op in v) {
            if (!isFilterComparerName(op))
                continue

            const p = fields[prop]

            if (p === undefined)
                continue

            const compare = filterComparers[op]
            compare(query, p, v[op])
        }
    }
}

export const applySort = (query: Knex.QueryBuilder, sort: SortType[], fields: Fields) => {
    query.orderBy(sort.map((o: SortType) => {
        const { field, desc } = isString(o) ? { field: o, desc: undefined } : o

        const p = fields[field]

        if (p === undefined)
            return undefined

        return {
            column: p,
            order: (desc ?? false) ? "desc" : "asc",
            nulls: "last"
        }
    }).filter(isDefined))
}