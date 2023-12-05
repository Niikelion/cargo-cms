import {z} from "zod";
import {fieldConstraintsSchema} from "../../schema-loader/reader";
import {TypeRegistryModule} from "../../type-registry";
import {generateStructure, getTableName, validatedDataType} from "@cargo-cms/database/schema/utils";
import assert from "assert";
import {build} from "@cargo-cms/database";
import {Table} from "@cargo-cms/database";
import {Structure} from "@cargo-cms/database/schema";
import {isNumber} from "@cargo-cms/utils";
import {DebugModule} from "../../debug";

const targetedRelations = z.union([
    z.literal("oneToOne"),
    z.literal("oneToMany"),
    z.literal("manyToOne"),
    z.literal("manyToMany")
])

const relations = z.union([
    z.literal("one"),
    z.literal("many"),
    targetedRelations
])

type Relation = z.infer<typeof relations>

const relationDataPayload = fieldConstraintsSchema.extend({
    type: z.string(),
    relation: relations,
    field: z.string().optional()
})

export const registerRelationDataType = (typeRegistry: TypeRegistryModule, debug: DebugModule) => {
    const { getEntityType } = typeRegistry

    const logSql = debug.channel("sql").log

    const relationDataType = validatedDataType("relation", relationDataPayload, (table, name, data) => {
        const type = getEntityType(data.type)

        assert(type !== null)

        const relation = data.relation

        const otherTable = getTableName(type)

        //we only need to reference other table, use single field
        const singleReference = () => {
            table.int(name, c => c.nullable().references('_id', { onDelete: "SET NULL" }).inTable(getTableName(type)))
            return null
        }

        //we need link table to connect entities across two tables
        const multiReference = (name: string, first: string, second: string) => {
            const newTable = build.table(name)

            newTable.int("_entityId", c => c.references("_id", { onDelete: "CASCADE" }).inTable(first))
            newTable.int("_targetId", c => c.references("_id", { onDelete: "CASCADE" }).inTable(second))
            newTable.composite(["_entityId", "_targetId"])

            return [ newTable ]
        }

        const relationHandlers = {
            oneToMany: () => null,
            one: singleReference, manyToOne: singleReference, oneToOne: singleReference,
            many: () => multiReference(`${table.name}__${name}`, table.name, otherTable),
            manyToMany: () => {
                assert(data.field !== undefined)

                const otherName = data.field

                const t1 = `${table.name}__${name}`
                const t2 =  `${otherTable}__${otherName}`

                const getNames = () => {
                    if (t1 < t2)
                        return [t1, table.name, otherTable]

                    return [t2, otherTable, table.name]
                }

                const [tableName, f, s] = getNames()

                return multiReference(tableName, f, s)
            }
        } as const satisfies Record<Relation, () => Table<string>[] | null>

        return relationHandlers[relation]()
    }, (args): Structure => {
        const {
            table,
            path,
            data,
            selector,
            uuidGenerator
        } = args

        const relation = data.relation

        const isSimpleRelation = relation === "one" || relation === "oneToOne" || relation === "manyToOne"

        const type = getEntityType(data.type)

        assert(type !== null)

        const otherTableName = getTableName(type)
        const otherTableAlias = uuidGenerator()

        const follow = selector !== "**"

        const structure = generateStructure(type, follow ? selector : {}, {uuidGenerator, tableName: isSimpleRelation ? otherTableAlias : undefined})

        if (isSimpleRelation) {

            assert(structure.data.type === "object")

            return {
                data: {
                    ...structure.data,
                    upload: {
                        type: "outwards",
                        getLinkData: value => {
                            assert(isNumber(value))
                            return {[path]: value}
                        }
                    }
                },
                joins: {
                    [otherTableAlias]: {
                        table: otherTableName,
                        build: query =>
                            query.leftJoin(
                                `${otherTableName} AS ${otherTableAlias}`,
                                `${table}.${path}`,
                                `${otherTableAlias}._id`)
                    },
                    ...structure.joins
                }
            } satisfies Structure
        }

        if (relation === "many") {
            const linkTable = `${table}__${path}`

            return {
                data: {
                    type: "array",
                    ...structure,
                    fetch: {
                        table: otherTableName,
                        query: (db, id) =>
                            db(linkTable).where({_entityId: id}).leftJoin(otherTableName, `${linkTable}._targetId`, `${otherTableName}._id`)
                    },
                    upload: {
                        table: linkTable,
                        getLinkData: (id, _, v) => {
                            assert(isNumber(v))
                            return ({_entityId: id, _targetId: v});
                        }
                    }
                },
                joins: {}
            } satisfies Structure
        }

        assert(data.field !== undefined)

        const otherName = data.field
        if (relation === "oneToMany") {
            return {
                data: {
                    type: "array",
                    ...structure,
                    fetch: {
                        table: otherTableName,
                        query: (db, id) =>
                            db(otherTableName).where({[otherName]: id})
                    },
                    upload: async (db, id, _, v) => {
                        assert(isNumber(v))

                        const query = db(otherTableName).update({[otherName]: id}).where('_id', v)

                        logSql(query.toSQL().sql)

                        await query.then()
                    }
                },
                joins: {}
            } satisfies Structure
        }

        const t1 = `${table}__${path}`
        const t2 = `${otherTableName}__${otherName}`

        const getNames = () => {
            if (t1 < t2)
                return [t1, "_entityId", "_targetId"]

            return [t2, "_targetId", "_entityId"]
        }

        const [tableName, field, otherField] = getNames()

        return {
            data: {
                type: "array",
                ...structure,
                fetch: {
                    table: otherTableName,
                    query: (db, id) =>
                        db(tableName).where({[field]: id}).leftJoin(otherTableName, `${tableName}.${field}`, `${otherTableName}.${otherField}`)
                },
                upload: {
                    table: tableName,
                    getLinkData: (id, _, v) => {
                        assert(isNumber(v))
                        return ({[field]: id, [otherField]: v});
                    }
                }
            },
            joins: {}
        } satisfies Structure
    }, data => {
        const type = getEntityType(data.type)

        const relation = data.relation

        if (type == null)
            return `Missing entity type: ${data.type}`

        if (relation !== "one" && relation !== "many" && data.field === undefined)
            return `Linked field in entity type ${data.type} not specified`

        return null
    })

    typeRegistry.registerDataType(relationDataType)
}
