import assert from "assert";
import {Knex} from "knex";
import {Structure, PrimitiveType, FilterType, SortType} from "./schema";
import {unFlattenStructure} from "./schema/utils";
import {JSONValue} from "@cargo-cms/utils/types"
import {isArray, isBool, isDefined, isNumber, isString} from "@cargo-cms/utils/filters"
import {applyFields, applyFilters, applyJoins, applySort, extractDataFromStructure} from "./utils";

export type QueryByStructureAdditionalArgs = {
    query?: Knex.QueryBuilder,
    filter?: FilterType,
    sort?: SortType[],
    limit?: number
}

export const queryByStructure = async (db: Knex, structure: Structure, tableName: string, args?: QueryByStructureAdditionalArgs): Promise<JSONValue[]> => {
    type Handler = (db: Knex, id: number) => Promise<JSONValue>

    const { query: q, filter, sort, limit } = args ?? {}

    const query: Knex.QueryBuilder = q ?? db(tableName)
    assert(query !== undefined)

    const customs: [string, Handler][] = []

    const pushCustom = (path: string, handler: Handler) => customs.push([path, handler])

    const { fields, joins } = extractDataFromStructure(structure, {
        onCustomObject: (path, obj) => pushCustom(path, (db, id) => {
            const tableName = obj.fetch.table
            const query = obj.fetch.query(db, id)
            return queryByStructure(db, {
                data: obj,
                joins: obj.joins
            }, tableName, { query })
        }),
        onArray: (path, array) => pushCustom(path, (db, id) => {
            const tableName = array.fetch.table
            const query = array.fetch.query(db, id)
            return queryByStructure(db, array, tableName, { query })
        }),
        onCustom: (path, custom) => pushCustom(path, custom.fetch)
    })

    query.select(db.raw("?? as ??", [`${tableName}._id`, 'id']))
    applyJoins(query, joins)
    applyFields(db, query, fields)

    if (limit !== undefined)
        query.limit(limit)
    if (filter !== undefined)
        applyFilters(query, filter, fields)
    if (sort !== undefined)
        applySort(query, sort, fields)

    //TODO: hide behind debug utility
    console.log(query.toSQL().sql)

    const results: (Record<string, PrimitiveType> & {id: number})[] = await query.then()

    return await Promise.all(results.map(async result => {
        let ret: JSONValue = unFlattenStructure(result)

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