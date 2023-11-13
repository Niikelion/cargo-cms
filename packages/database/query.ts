import assert from "assert";
import knex from "knex"
import {Structure, StructureField, PrimitiveType, FilterType, OrderType} from "./schema";
import {unflattenStructure} from "./schema/utils";
import {JSONValue} from "@cargo-cms/utils/types"
import {isArray, isBool, isDefined, isNumber, isString} from "@cargo-cms/utils/filters"

export const fetchByStructure = async (db: knex.Knex, structure: Structure, tableName: string, args?: {
    query?: knex.Knex.QueryBuilder,
    filter?: FilterType,
    order?: OrderType[]
}): Promise<JSONValue[]> => {
    type Handler = (db: knex.Knex, id: number) => Promise<JSONValue>

    const { query: q, filter, order } = args ?? {}

    const query = q ?? db(tableName)
    assert(query !== undefined)

    const fields: Record<string, string> = {}
    const joins: [string, Structure["joins"][string]][] = []
    const customs: [string, Handler][] = []

    Object.entries(structure.joins).forEach(join => joins.push(join))

    const extractData = (path: string, s: StructureField) => {
        const pushCustom = (handler: Handler) => customs.push([path, handler])

        switch (s.type) {
            case "string": case "number": case "boolean": fields[path] = s.id; break
            case "object": {
                if (s.fetch !== undefined) {
                    pushCustom((db, id) => {
                        const [tableName, query] = s.fetch(db, id)

                        return fetchByStructure(db, {
                            data: s,
                            joins: s.joins
                        }, tableName, { query })
                    })
                    break
                }

                Object.entries(s.fields).forEach(([name, field]) => {
                    extractData(path.length > 0 ? `${path}.${name}` : name, field)
                })
                break
            }
            case "array": {
                pushCustom((db, id) => {
                    const [tableName, query] = s.fetch(db, id)
                    return fetchByStructure(db, s, tableName, { query })
                })
                break
            }
            case "custom": pushCustom(s.handler); break
        }
    }

    extractData("", structure.data)

    query.select(db.raw("?? as ??", [`${tableName}._id`, 'id']))
    joins.forEach(([_, join]) => join(query))
    Object.entries(fields).forEach(([path, id]) => query.select(db.raw('?? as ??', [id, path.replace(".", "/")])))

    if (filter !== undefined) {
        type CF = (q: knex.Knex.QueryBuilder) => void
        type Q = knex.Knex.QueryBuilder
        const applyFilters = (filter: FilterType, query: Q) => {
            for (const prop in filter) {
                const v = filter[prop]

                if (isArray(v)) {
                    const combiners: Record<string, (f: CF) => void> = {
                        "#and": (f: CF) => query.andWhere(f),
                        "#or": (f: CF) => query.orWhere(f)
                    }

                    if (!Object.keys(combiners).includes(prop))
                        continue

                    v.forEach((v, i) => {
                        const innerFilter = (q: Q) => applyFilters(v, q)

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
                        "#eq": (q: Q) => q.where(p, "=", val),
                        "#neq": (q: Q) => q.where(p, "<>", val),
                        "#null": (q: Q) => q.whereNull(p),
                        "#nnull": (q: Q) => q.whereNotNull(p),
                        "#lt": (q: Q) => q.where(p, "<", val),
                        "#lte": (q: Q) => q.where(p, "<=", val),
                        "#gt": (q: Q) => q.where(p, ">", val),
                        "#ge": (q: Q) => q.where(p, ">=", val)
                        //TODO: add more checks
                    }

                    if (!Object.keys(comparers).includes(op))
                        continue

                    comparers[op](query)
                }
            }
        }

        applyFilters(filter, query)
    }
    if (order !== undefined) {
        query.orderBy(order.map((o: OrderType) => {
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

    console.log(query.toSQL().sql)

    const results: (Record<string, PrimitiveType> & {id: number})[] = await query.then()

    return await Promise.all(results.map(async result => {
        let ret: JSONValue = unflattenStructure(result)

        const { id } = result

        for (const [path, handler] of customs) {
            const tree = await handler(db, id)
            const parts = path.split('.')
            let root = ret
            const end = parts.pop()

            if (end === undefined)
                throw new Error("internal error")

            parts.forEach(part =>  {
                const next = root[part]
                assert(isDefined(next))
                assert(!(isNumber(next) || isString(next) || isBool(next) || isArray(next)))

                root = next
            })

            root[end] = tree
        }

        return ret
    }))
}