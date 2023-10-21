import knex from "knex";
import {Schema} from "../schema/types";

export const constructTable = async (db: knex.Knex, schema: Schema) => {
    if (schema.fields.length == 0) {
        console.error(`Error: empty construct: ${schema.name}, skipping creation`)
        return
    }

    const tableName = schema.name.replace(".", "_")

    await db.schema.createTable(tableName, creator => {
        for (const field of schema.fields) {
            field.type.generateField(creator, field.name, field.constraints)
        }
    }).then()
}