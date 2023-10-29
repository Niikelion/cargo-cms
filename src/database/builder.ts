import knex from "knex";
import {nameGenerator} from "../schema/utils";

type FieldType = "text" | "varchar" | "integer" | "float" | "double" | "boolean" | "increments"

type LengthCheckType = "eq" | "ne" | "gt" | "lt" | "le" | "ge"

type FullField = {
    readonly name: string
    readonly type: FieldType
    isUnique: boolean
    isNullable: boolean
    range?: { min: number, max: number }
    foreign?: { table: string, field: string }
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
    references(field: string): { inTable(table: string): Field }
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

const applyField = (fieldData: FullField, tableBuilder: knex.Knex.CreateTableBuilder, alter: boolean) => {
    const name = fieldData.name
    const makeField = (): knex.Knex.ColumnBuilder => {
        switch (fieldData.type) {
            case "integer": return tableBuilder.integer(name)
            case "float": return tableBuilder.float(name)
            case "double": return tableBuilder.double(name)
            case "text": return tableBuilder.text(name)
            case "varchar": return tableBuilder.string(name)
            case "boolean": return tableBuilder.boolean(name)
            case "increments": return tableBuilder.increments(name)
        }
    }

    const c = nameGenerator(name)

    const field = makeField()

    if (fieldData.isUnique)
        field.unique()

    if (fieldData.range !== undefined)
        field.checkBetween([fieldData.range.min, fieldData.range.max], c`value_range`)

    if (fieldData.foreign !== undefined)
        field.references(fieldData.foreign.field).inTable(fieldData.foreign.table)

    if (fieldData.isNullable)
        field.nullable()
    else
        field.notNullable()

    if (fieldData.pattern !== undefined)
        field.checkRegex(fieldData.pattern)

    if (fieldData.isPositive)
        field.checkPositive()

    if (fieldData.isNegative)
        field.checkNegative()

    if (fieldData.isOneOf !== undefined)
        field.checkIn(fieldData.isOneOf)

    if (fieldData.isNotOneOf !== undefined)
        field.checkNotIn(fieldData.isNotOneOf);

    const checkMap: Record<LengthCheckType, "=" | "!=" | "<=" | ">=" | "<" | ">"> = {
        eq: "=",
        ne: "!=",
        le: "<=",
        ge: ">=",
        lt: "<",
        gt: ">"
    } as const

    (fieldData.lengthChecks ?? []).forEach(check => field.checkLength(checkMap[check.type], check.value))

    if (alter && field.alter)
        field.alter()
}

const mkField = (name: string, type: FieldType): Field => {
    const ret: Field = {
        name,
        type,
        isUnique: false,
        isNullable: false,
        isPositive: false,
        isNegative: false,
        inRange(min: number, max: number) {
            ret.range = { min, max }
            return ret
        },
        references(field: string): { inTable(table: string): Field } {
            return { inTable(table: string): Field {
                ret.foreign = { field, table }
                return ret
            } }
        },
        positive(): Field {
            ret.isPositive = true
            return ret
        },
        negative(): Field {
            ret.isNegative = true
            return ret
        },
        oneOf(values: string[]): Field {
            ret.isOneOf = values
            return ret
        },
        notOneOf(values: string[]): Field {
            ret.isNotOneOf = values
            return ret
        },
        regex(pattern: string): Field {
            ret.pattern = pattern
            return ret
        },
        length(type: LengthCheckType, value: number): Field {
            ret.lengthChecks ??= []
            ret.lengthChecks.push({type, value})
            return ret
        },
        unique() {
            ret.isUnique = true
            return ret
        },
        nullable(isNullable?: boolean) {
            ret.isNullable = isNullable ?? true
            return ret
        },
        apply(tableBuilder: knex.Knex.CreateTableBuilder, alter: boolean) {
            return applyField(ret, tableBuilder, alter)
        }
    } satisfies Field
    return ret
}

type Fields<V extends string> = { [K in V]: Field }

type FieldCreator<V extends string, F extends Partial<Field>> = <N extends string>(name: N, constraintsBuilder?: (field: F) => void) => Table<V | N>

const fieldCreator = <V extends string, F extends Partial<Field>> (tableName: string, fields: Fields<V>, type: FieldType) => <N extends string>(name: N, constraintsBuilder?: (field: F) => void): Table<V | N> => {
    const field = mkField(name, type)

    if (constraintsBuilder)
        constraintsBuilder(field as F)

    const newFields = fields as Fields<V | N>

    newFields[name] = field

    return mkTable<V | N>(tableName, newFields)
}

export type Table<V extends string> = {
    readonly name: string
    readonly fields: Fields<V>

    readonly int: FieldCreator<V, NumericField>
    readonly inc: FieldCreator<V, NumericField>
    readonly float: FieldCreator<V, NumericField>
    readonly double: FieldCreator<V, NumericField>
    readonly string: FieldCreator<V, TextField>
    readonly text: FieldCreator<V, TextField>
    readonly bool: FieldCreator<V, BooleanField>

    apply(builder: knex.Knex.CreateTableBuilder, existed: boolean, columns: Set<string>): void
}

const mkTable = <V extends string>(name: string, fields: Fields<V>): Table<V> => {
    return {
        name,
        fields,

        int: fieldCreator<V, NumericField>(name, fields, "integer"),
        inc: fieldCreator<V, NumericField>(name, fields, "increments"),
        float: fieldCreator<V, NumericField>(name, fields, "float"),
        double: fieldCreator<V, NumericField>(name, fields, "double"),
        string: fieldCreator<V, TextField>(name, fields, "varchar"),
        text: fieldCreator<V, TextField>(name, fields, "text"),
        bool: fieldCreator<V, BooleanField>(name, fields, "boolean"),

        apply(builder, exists, columns) {
            for (const f in fields) {
                const field = fields[f]
                field.apply(builder, exists && columns.has(field.name))
            }
        }
    } satisfies Table<V>
}

export const build = {
    table(name: string) { return mkTable<never>(name, {}) }
}