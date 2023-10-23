import knex from "knex";

export type TableBuilder = knex.Knex.CreateTableBuilder & {
    existed: (field: string) => boolean
    useField: (field: string, column?: ColumnBuilder) => boolean
    additionalTable: (name: string, builder: (builder: TableBuilder) => void) => void
}
export type ColumnBuilder = knex.Knex.ColumnBuilder