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
    additionalTables: (TablePlan | ((id: number) => InsertPlan))[],
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
    console.dir({value})

    const paramTables: ((id: number) => InsertPlan)[] = []
    const customInsertions: InsertPlan["custom"] = []

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

            const plans: InsertPlan[] = v.map(e => extractInsertPlan(arr, arr.fetch.table, e))

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
        onCustomObject: (path, obj) => {
            const v = dig(value, path)

            const u = obj.upload
            if (u instanceof Function) {
                customInsertions.push((db, id) => u(db, id, v))
                return
            }

            const plan = extractInsertPlan({
                data: {
                    type: "object",
                    fields: obj.fields
                },
                joins: obj.joins
            }, u.table, v)

            paramTables.push((id: number) => {
                plan.mainTable.data = {
                    ...plan.mainTable.data,
                    ...u.getLinkData(id,v)
                }

                return plan
            })
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

    const directFields = data[tableName]

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
        additionalTables: [...additionalTables, ...paramTables],
        custom: customInsertions
    }
}

const executeInsertPlan = async (db: Knex, plan: InsertPlan): Promise<number> => {
    const { mainTable, additionalTables, custom } = plan

    const query = db.insert(mainTable.data).into(mainTable.name).returning("_id").onConflict(["_id"]).merge()

    //TODO: hide behind debug utility
    console.log(query.toSQL().sql)

    const ret = await query.then() as { _id: number }[]

    const id = ret[0]._id

    const additionalTablesTasks= additionalTables.map(async subPlan => {
        if (subPlan instanceof Function)
            return await executeInsertPlan(db, subPlan(id))

        await executeInsertPlan(db, { mainTable: subPlan, additionalTables: [], custom: [] })
    })

    const customInsertionsTasks = custom.map(async c => c(db, id))

    await Promise.all([...additionalTablesTasks, ...customInsertionsTasks])

    return id
}

export const insert = async (db: Knex, structure: Structure, tableName: string, value: JSONValue): Promise<void> => {
    const plan = extractInsertPlan(structure, tableName, value)

    console.dir({plan}, {depth: 10})

    const id = await executeInsertPlan(db, plan)

    console.dir({id})
}