import knex from "knex";

export type TableBuilder = knex.Knex.CreateTableBuilder & {
    existed: (field: string) => boolean
    useName: (field: string) => boolean
}
export type ColumnBuilder = knex.Knex.ColumnBuilder