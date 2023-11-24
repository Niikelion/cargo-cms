import knex from "knex";

export type FieldType = "text" | "varchar" | "integer" | "float" | "double" | "boolean" | "increments"
export type LengthCheckType = "eq" | "ne" | "gt" | "lt" | "le" | "ge"

type FullField = {
    readonly name: string
    readonly type: FieldType
    isUnique: boolean
    isNullable: boolean
    range?: { min: number, max: number }
    foreign?: { table: string, field: string, onUpdate?: string, onDelete?: string }
    isPositive: boolean
    isNegative: boolean
    isOneOf?: string[]
    isNotOneOf?: string[]
    pattern?: string
    lengthChecks?: {
        type: LengthCheckType,
        value: number
    }[]
}

export type Field = FullField & {
    inRange(min: number, max: number): Field
    references(field: string, callbacks?: {
        onDelete?: string,
        onUpdate?: string
    }): { inTable(table: string): Field }
    positive(): Field
    negative(): Field
    oneOf(values: string[]): Field
    notOneOf(values: string[]): Field
    regex(pattern: string): Field
    length(type: LengthCheckType, value: number): Field
    nullable(isNullable?: boolean): Field
    unique(): Field
    apply(tableBuilder: knex.Knex.CreateTableBuilder, alter: boolean): void
}

export type NumericField = Field & {
    inRange(min: number, max: number): NumericField
    references(field: string): { inTable(table: string): NumericField }
    positive(): NumericField
    negative(): NumericField
    nullable(isNullable?: boolean): NumericField
    unique(): NumericField
}

export type TextField = Omit<Field, "range" | "inRange"> & {
    references(field: string): { inTable(table: string): TextField }
    oneOf(values: string[]): TextField
    notOneOf(values: string[]): TextField
    regex(pattern: string): TextField
    length(type: LengthCheckType, value: number): TextField
    nullable(isNullable?: boolean): TextField
    unique(): TextField
}

export type BooleanField = Omit<Field, "range" | "inRange"> & {
    references(field: string): { inTable(table: string): BooleanField }
    nullable(isNullable?: boolean): BooleanField
    unique(): BooleanField
}

export type Fields<V extends string> = { [K in V]: Field }

type FieldCreator<V extends string, F extends Partial<Field>> = <N extends string>(name: N, constraintsBuilder?: (field: F) => void) => Table<V | N>

export type Table<V extends string> = {
    readonly name: string
    readonly fields: Fields<V>
    readonly composites: string[][]

    readonly int: FieldCreator<V, NumericField>
    readonly inc: FieldCreator<V, NumericField>
    readonly float: FieldCreator<V, NumericField>
    readonly double: FieldCreator<V, NumericField>
    readonly string: FieldCreator<V, TextField>
    readonly text: FieldCreator<V, TextField>
    readonly bool: FieldCreator<V, BooleanField>
    readonly composite: (fields: string[]) => Table<V>

    apply(builder: knex.Knex.CreateTableBuilder, existed: boolean, columns: Set<string>): void
}