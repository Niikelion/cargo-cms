import {JSONValue} from "../server/types";
import {generateStructure, getEntityType} from "../schema";
import {RestApiError} from "../server/utils";
import knex from "knex";
import {InputStructure, Structure, StructureField} from "../schema/types";
import {getTableName} from "../database/table";
import assert from "assert";
import {isArray, isBool, isDefined, isNumber, isString} from "../utils/filters";

//TODO: add population, filtering, ordering and stuff like that
export const getEntities = async (db: knex.Knex, typeName: string): Promise<JSONValue> => {
    const type = getEntityType(typeName)

    if (type === null)
        throw new RestApiError(`Entity type ${typeName} not found`, 404)

    const structure = generateStructure(type)

    console.dir(structure, {depth: 10})

    const tableName = getTableName(type)

    console.dir(await fetchByStructure(db, structure, tableName), {depth: 10})

    return []
}

type PrimitiveType = string | number | boolean | null

const restructureData = (source: Record<string, PrimitiveType>): Record<string, JSONValue> => {
    const ret: Record<string, JSONValue> = {}

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

//TODO: add population, filtering, ordering and stuff like that
export const fetchByStructure = async (db: knex.Knex, structure: Structure, tableName: string, q?: knex.Knex.QueryBuilder): Promise<JSONValue[]> => {
    type Handler = (db: knex.Knex, id: number, input: InputStructure) => Promise<JSONValue>

    const query = q ?? db(tableName)
    assert(query !== undefined)

    const fields: [string, string][] = []
    const joins: [string, Structure["joins"][string]][] = []
    const customs: [string, Handler][] = []

    Object.entries(structure.joins).forEach(join => joins.push(join))

    const extractData = (path: string, s: StructureField) => {
        const pushCustom = (handler: Handler) => customs.push([path, handler])

        switch (s.type) {
            case "string": case "number": case "boolean": fields.push([path, s.id]); break
            case "object": {
                const fetch = s.fetch

                if (fetch !== undefined) {
                    pushCustom((db, id, _) => {
                        const [tableName, query] = fetch(db, id)

                        return fetchByStructure(db, {
                            data: s,
                            joins: s.joins
                        }, tableName, query)
                    })
                    break
                }

                Object.entries(s.fields).forEach(([name, field]) => {
                    extractData(path.length > 0 ? `${path}.${name}` : name, field)
                })
                break
            }
            case "array": {
                pushCustom((db, id, _) => {
                    const [tableName, query] = s.fetch(db, id)
                    return fetchByStructure(db, s, tableName, query)
                })
                break
            }
            case "custom": customs.push([path, s.handler]); break
        }
    }

    extractData("", structure.data)

    query.select(`${tableName}._id`)

    joins.forEach(([_, join]) => join(query))
    fields.forEach(([path, id]) => query.select(db.raw('?? as ??', [id, path.replace(".", "/")])))

    console.log(query.toSQL().sql)

    const results: (Record<string, PrimitiveType> & {_id: number})[] = await query.then()

    return await Promise.all(results.map(async result => {
        let ret = restructureData(result)

        const id = result._id

        for (const [path, handler] of customs) {
            const tree = await handler(db, id, ret)
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