import {Knex} from "knex";
import {PrimitiveType, Structure} from "./schema";
import {JSONValue} from "@cargo-cms/utils/types";
import {extractDataFromStructure} from "./utils";
import {isArray, isPrimitive} from "@cargo-cms/utils/filters";
import assert from "assert";

type TablePlan = {
    name: string,
    data: Record<string, PrimitiveType>
}

type InsertPlan = {
    mainTable: TablePlan,
    tables: TablePlan[]
    dependentTables: ((id: number) => InsertPlan)[],
    custom: ((db: Knex, id: number) => Promise<void>)[]
}

const dig = (obj: JSONValue, path: string, separator: string = "/") => {
    let ret: JSONValue = obj
    const parts = path.split(separator)
    parts.forEach(part => {
        if (isPrimitive(ret) || isArray(ret))
            throw new Error("Incorrect path")

        ret = ret[part]
    })

    return ret
}

const extractInsertPlan = (structure: Structure, tableName: string, value: JSONValue): InsertPlan => {
    const paramTables: ((id: number) => InsertPlan)[] = []
    const customInsertions: InsertPlan["custom"] = []
    let additionalData: Record<string, PrimitiveType> = {}

    const { fields, joins } = extractDataFromStructure(structure, {
        onArray: (path, arr) => {
            const v = dig(value, path)
            assert(isArray(v))

            const u = arr.upload

            if (u instanceof Function) {
                v.forEach((e, i) =>
                    customInsertions.push((db, id) => u(db, id, i, e)))
                return
            }

            const plans: InsertPlan[] = v.map(e => extractInsertPlan({ data: arr.data, joins: arr.joins }, u.table, e))

            plans.forEach((plan, i) => {
                paramTables.push((id: number) => {
                    plan.mainTable.data = {
                        ...plan.mainTable.data,
                        ...u.getLinkData(id, i, v[i])
                    }

                    return plan
                })
            })
        },
        onCustomObjectUpload: (path, obj) => {
            const v = dig(value, path)

            const u = obj.upload

            switch (u.type) {
                case "custom": {
                    customInsertions.push((db, id) => u.upload(db, id, v))
                    return
                }
                case "inwards": {
                    const plan = extractInsertPlan({
                        data: obj,
                        joins: obj.fetch !== undefined ? obj.joins : {}
                    }, u.table, v)

                    paramTables.push((id: number) => {
                        plan.mainTable.data = {
                            ...plan.mainTable.data,
                            ...u.getLinkData(id,v)
                        }

                        return plan
                    })

                    return
                }
                case "outwards": {
                    additionalData = Object.assign(additionalData, u.getLinkData(v))
                    return
                }
            }
        },
        onCustom: (path, custom) => {
            customInsertions.push((db: Knex, id: number) => custom.upload(db, id, dig(value, path)))
        }
    })

    const data: Record<string, Record<string, JSONValue>> = {}

    for (const name in fields) {
        const path = fields[name]

        const pathParts = path.split('.')
        const table = pathParts[0]
        const member = pathParts[1]

        //TODO: iterate object and generate structure this way instead of iterating table fields
        const v = dig(value, name, "/")

        data[table] ??= {}
        data[table][member] = v
    }

    const tableAliasMapping: Record<string, string> = {}

    for (const alias in joins) {
        const [table] = joins[alias]
        tableAliasMapping[alias] = table
    }

    const originalData = data[tableName]

    const directFields: Record<string, JSONValue> = originalData ? Object.assign(originalData, additionalData): originalData ?? additionalData

    const additionalTables: TablePlan[] = []

    for (const name in data) {
        if (name === tableName)
            continue

        const table = tableAliasMapping[name] ?? name

        const filter = (e: [string, JSONValue]): e is [string, PrimitiveType] => isPrimitive(e[1])

        //TODO: maybe refine value using custom handlers?
        const finalData = Object.fromEntries(Object.entries(data[name]).filter(filter))

        additionalTables.push({
            name: table,
            data: finalData
        })
    }

    return {
        mainTable: {
            name: tableName,
            data: directFields as Record<string, PrimitiveType>
        },
        tables: additionalTables,
        dependentTables: paramTables,
        custom: customInsertions
    }
}

const executeInsertPlan = async (db: Knex, plan: InsertPlan, logSql?: (sql: string) => void): Promise<number> => {
    const { mainTable, tables, dependentTables, custom } = plan

    const mainTask = async () => {
        const query = db.insert(mainTable.data).into(mainTable.name).returning("_id").onConflict(["_id"]).merge()

        if (logSql)
            logSql(query.toSQL().sql)

        const ret = await query.then() as { _id: number }[]

        const id = ret[0]._id

        const dependentTablesTasks = dependentTables.map(subPlan => executeInsertPlan(db, subPlan(id), logSql))

        const customInsertionsTasks = custom.map(async c => c(db, id))

        await Promise.all([...dependentTablesTasks, ...customInsertionsTasks])

        return id
    }

    const [id] = await Promise.all([mainTask(), ...tables.map(async table => {
        const query = db.insert(table.data).into(table.name).onConflict(["_id"]).merge()

        if (logSql)
            logSql(query.toSQL().sql)

        return query.then();
    })])
    return id
}

export const insert = async (db: Knex, structure: Structure, tableName: string, value: JSONValue, logSql?: (sql: string) => void): Promise<number> => {
    const plan = extractInsertPlan(structure, tableName, value)

    return await executeInsertPlan(db, plan, logSql)
}