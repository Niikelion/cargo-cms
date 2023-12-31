import knex from "knex";
import {nameGenerator} from "@cargo-cms/utils/generators"
import {BooleanField, Field, Fields, FieldType, LengthCheckType, NumericField, Table, TextField} from "./types";

const applyField = (fieldData: Field, tableBuilder: knex.Knex.CreateTableBuilder, alter: boolean) => {
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

    if (fieldData.foreign !== undefined) {
        const f = field.references(fieldData.foreign.field).inTable(fieldData.foreign.table)

        if (fieldData.foreign.onUpdate !== undefined)
            f.onUpdate(fieldData.foreign.onUpdate)

        if (fieldData.foreign.onDelete !== undefined)
            f.onDelete(fieldData.foreign.onDelete)
    }

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
        references(field: string, callbacks): { inTable(table: string): Field } {
            return { inTable(table: string): Field {
                    ret.foreign = { field, table, onUpdate: callbacks?.onUpdate, onDelete: callbacks?.onDelete }
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

const fieldCreator = <V extends string, F extends Partial<Field>> (tableName: string, fields: Fields<V>, composites: string[][], type: FieldType) => <N extends string>(name: N, constraintsBuilder?: (field: F) => void): Table<V | N> => {
    const field = mkField(name, type)

    if (constraintsBuilder)
        constraintsBuilder(field as F)

    const newFields = fields as Fields<V | N>

    newFields[name] = field

    return mkTable<V | N>(tableName, newFields, composites)
}

const mkTable = <V extends string>(name: string, fields: Fields<V>, composites: string[][]): Table<V> => {
    return {
        name,
        fields,
        composites,

        int: fieldCreator<V, NumericField>(name, fields, composites, "integer"),
        inc: fieldCreator<V, NumericField>(name, fields, composites, "increments"),
        float: fieldCreator<V, NumericField>(name, fields, composites, "float"),
        double: fieldCreator<V, NumericField>(name, fields, composites, "double"),
        string: fieldCreator<V, TextField>(name, fields, composites, "varchar"),
        text: fieldCreator<V, TextField>(name, fields, composites, "text"),
        bool: fieldCreator<V, BooleanField>(name, fields, composites, "boolean"),

        composite(columns: string[]) {
            composites.push(columns)
            return mkTable(name, fields, composites)
        },

        apply(builder, exists, columns) {
            for (const f in fields) {
                const field = fields[f]
                field.apply(builder, exists && columns.has(field.name))
            }
            for (const composite of composites) {
                builder.unique(composite)
            }
        }
    } satisfies Table<V>
}

export const build = {
    table(name: string) { return mkTable<never>(name, {}, []) }
}