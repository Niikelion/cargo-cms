import {FieldFetcher, FilterType, SortType, Structure, StructureField} from "./schema";
import {Knex} from "knex";
import {isArray, isDefined, isString} from "@cargo-cms/utils/filters";

type ExtractHandlers = {
    onCustomObject?: (path: string, obj: StructureField & { type: "object", fetch: FieldFetcher }) => void
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

export const applyFilters = (query: Knex.QueryBuilder, filter: FilterType, fields: Fields): void => {
    type Q = Knex.QueryBuilder
    type CF = (q: Q) => void

    for (const prop in filter) {
        const v = filter[prop]

        if (isArray(v)) {
            const combiners: Record<string, (f: CF) => void> = {
                "!and": (f: CF) => query.andWhere(f),
                "!or": (f: CF) => query.orWhere(f),
                "!not": (f: CF) => query.whereNot(f)
            }

            if (!Object.keys(combiners).includes(prop))
                continue

            v.forEach((v, i) => {
                const innerFilter = (q: Q) => applyFilters(q, v, fields)

                if (i === 0) {
                    query.where(innerFilter);
                    return
                }

                combiners[prop](innerFilter)
            })

            continue
        }

        for (const op in v) {
            const val = v[op]

            const p = fields[prop]
            if (p === undefined)
                continue

            const comparers: Record<string, (q: Q) => void> = {
                "!eq": (q: Q) => q.where(p, "=", val),
                "!neq": (q: Q) => q.where(p, "<>", val),
                "!null": (q: Q) => q.whereNull(p),
                "!notNull": (q: Q) => q.whereNotNull(p),
                "!lt": (q: Q) => q.where(p, "<", val),
                "!lte": (q: Q) => q.where(p, "<=", val),
                "!gt": (q: Q) => q.where(p, ">", val),
                "!ge": (q: Q) => q.where(p, ">=", val),
                "!like": (q: Q) => q.whereLike(p, val),
                "!in": (q: Q) => q.whereIn([p], [val as string[]]),
                "!between": (q: Q) => q.whereBetween(p, val as [number, number])
            }

            if (!Object.keys(comparers).includes(op))
                continue

            comparers[op](query)
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