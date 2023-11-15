import {Knex} from "knex";
import {FilterType, Structure} from "./schema";
import {applyFields, applyFilters, applyJoins, extractDataFromStructure} from "./utils";

export const removeWithFilter = async (db: Knex, structure: Structure, tableName: string, filter: FilterType): Promise<number> => {
    //TODO: implement
    const query: Knex.QueryBuilder = db(tableName)

    const { fields, joins } = extractDataFromStructure(structure)

    fields["id"] = "_id"

    applyJoins(query, joins)
    applyFields(db, query, fields)
    applyFilters(query, filter, fields)

    query.delete()

    //TODO: hide behind debug utility
    console.log(query.toSQL().sql)

    const ret: number = await query.then()

    console.log(ret)

    return ret
}