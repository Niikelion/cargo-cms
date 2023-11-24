import {Knex} from "knex";
import {FilterType, Structure} from "./schema";
import {applyFields, applyFilters, applyJoins, extractDataFromStructure} from "./utils";

export const removeWithFilter = async (db: Knex, structure: Structure, tableName: string, filter: FilterType, logSql?: (sql: string) => void): Promise<void> => {
    const query: Knex.QueryBuilder = db(tableName)

    const { fields, joins } = extractDataFromStructure(structure)

    fields["id"] = "_id"

    applyJoins(query, joins)
    applyFields(db, query, fields)
    applyFilters(query, filter, fields)

    query.delete("_id")

    if (logSql)
        logSql(query.toSQL().sql)

    await query.then()
}