import {Knex} from "knex";
import {Structure} from "./schema";
import {JSONValue} from "@cargo-cms/utils/types";
import {extractDataFromStructure} from "./utils";
import {isArray, isBool, isNumber, isString} from "@cargo-cms/utils/filters";

export const insert = async (db: Knex, structure: Structure, tableName: string, value: JSONValue): Promise<void> => {
    const { fields } = extractDataFromStructure(structure)

    const fieldList = Object.entries(fields).filter(e => e[1].startsWith(`${tableName}.`))

    const directFields = Object.fromEntries(fieldList.map(([path, id]) => {
        let root: JSONValue = value

        const p = path.split(".")

        p.forEach(part => {
            if (isString(root) || isBool(root) || isNumber(root) || isArray(root) || root === null)
                throw new Error("Invalid value type")

            root = root[part]
        })

        return [id.substring(tableName.length + 1), root];
    }))

    const query = db.insert(directFields).into(tableName).onConflict(["_id"]).merge()

    //TODO: hide behind debug utility
    console.log(query.toSQL().sql)

    //TODO: insert into other tables that are part of given type
    await query.then()
}