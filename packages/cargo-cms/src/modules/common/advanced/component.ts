import {fieldConstraintsSchema} from "../../schema-loader/reader";
import {z} from "zod";
import {TypeRegistryModule} from "../../type-registry";
import {descendSelector, validatedDataType} from "@cargo-cms/database/schema/utils";
import {isDefined} from "@cargo-cms/utils";
import {build} from "@cargo-cms/database";
import {nameGenerator} from "@cargo-cms/utils/generators";
import {Structure, StructureField} from "@cargo-cms/database/schema";

const componentDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    list: z.boolean().optional()
})

export const registerComponentDataType = (typeRegistry: TypeRegistryModule) => {
    const {getComponentType} = typeRegistry

    const componentDataType = validatedDataType("component", componentDataPayload,
        (table, name, data, config) => {
            const type = getComponentType(data.type)

            if (type == null)
                throw new Error("Internal error")

            const isList = data.list ?? false

            // if not using list, simply prefix all fields and add them to current table
            if (!isList)
                return type.fields.map(field => field.type.generateColumns(table, `${name}_${field.name}`, field.constraints, config)).filter(isDefined).flat()

            //otherwise, create separate table for items with link to current table
            const tableName = `${table.name}__${name}`

            const newTable = build.table(tableName)
            newTable.int("_entityId", c => c.references("_id", {onDelete: "CASCADE"}).inTable(table.name))
            newTable.int("_order")
            newTable.composite(["_entityId", "_order"])

            const tables = type.fields.map(field => field.type.generateColumns(newTable, field.name, field.constraints, config)).filter(isDefined).flat()

            return [newTable, ...tables]
        },
        ({table, path, data, selector, ...args}) => {
            const c = nameGenerator(path)

            const type = getComponentType(data.type)
            if (type == null)
                throw new Error("Internal error")

            const isList = data.list ?? false

            const fields: Record<string, StructureField> = {}
            const joins: Structure["joins"] = {}

            const tableName = isList ? `${table}__${path}` : table
            const newTable = isList ? tableName : table

            const subStructures = type.fields.map(field => {
                const fieldSelector = descendSelector(selector, field.name)
                if (fieldSelector === null)
                    return null

                return ({
                    field,
                    structure: field.type.generateStructure({
                        ...args,
                        table: newTable,
                        path: isList ? field.name : c`${field.name}`,
                        data: field.constraints,
                        selector: fieldSelector
                    })
                });
            }).filter(isDefined)
            subStructures.forEach(structure => {
                fields[structure.field.name] = structure.structure.data
                Object.entries(structure.structure.joins).forEach(([name, value]) =>
                    joins[name] = value)
            })

            const componentStructure = {
                data: {
                    type: "object", fields
                }, joins
            } satisfies Structure

            if (!isList)
                return componentStructure

            return {
                data: {
                    type: "array",
                    fetch: {
                        table: tableName,
                        query: (db, id) => db(tableName).where({_entityId: id}).orderBy("_order", "asc", "last")
                    },
                    upload: {
                        table: tableName,
                        getLinkData: (id, i) => ({_entityId: id, _order: i})
                    },
                    ...componentStructure
                }, joins: {}
            } satisfies Structure
        },
        data => {
            const type = getComponentType(data.type)

            if (type == null)
                return `Missing component type: ${data.type}`

            return null
        })

    typeRegistry.registerDataType(componentDataType)
}