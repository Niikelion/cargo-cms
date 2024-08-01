import {describe, expect, test} from "vitest"
import fs from "fs/promises"
import {DatabaseDriver, DataSchema, diffSchema, KnexDriver, ResponseSelector, schemaEquals, TypesSchema} from "../src";

type DriverFactory = () => Promise<DatabaseDriver>

const driversData: {factory: DriverFactory, name: string}[] = [
    {
        name: "knex sqlite",
        factory: async () => {
            await fs.rm("./test/db.sqlite", {force: true})
            return new KnexDriver({
                client: "sqlite3",
                connection: {filename: "./test/db.sqlite"},
                useNullAsDefault: true
            })
        }
    }
]

const drivers = driversData.map(({name, factory}) =>
    ({createDriver: factory, driverName: name}))

const flushPromises = () => new Promise(r => setTimeout(r));

const stringType: DataSchema = { type: "string" }
const textType: DataSchema = { type: "text" }
const booleanType: DataSchema = { type: "boolean" }
const integerType: DataSchema = { type: "integer" }
const doubleType: DataSchema = { type: "float" }
const linkField = (target: string): DataSchema => ({ type: "relation", target, multiple: false, bidirectional: false })

describe.each(drivers)(`knex database driver for $driverName`, async ({createDriver}) => {
    const simpleSchema: TypesSchema = {
        user: {
            name: "user",
            type: "object",
            fields: {
                name: stringType,
                password: stringType,
            }
        }
    }
    const complexSchema: TypesSchema = {
        user: {
            name: "user",
            type: "object",
            fields: {
                name: stringType,
                password: stringType,
                verified: booleanType,
                bio: textType,
                level: integerType,
                balance: doubleType
            }
        },
        blogPost: {
            name: "blogPost",
            type: "object",
            fields: {
                author: linkField("user")
            }
        }
    }

    const init = async () => {
        const driver = await createDriver()
        await driver.init()
        return driver
    }

    test('empty run with integrity check', async () => {
        const driver = await createDriver()

        await driver.init()
        await driver.performIntegrityCheck()
        await driver.close()

        await flushPromises()
    })

    test('simple run, apply schema and pass integrity checks', async () => {
        const driver = await init()

        await driver.applySchema(simpleSchema)
        await driver.performIntegrityCheck()

        await driver.close()
        await flushPromises()
    })

    test('complex schema, apply schema using all table features and pass integrity checks', async () => {
        const driver = await init()

        await driver.applySchema(complexSchema)
        await driver.performIntegrityCheck()

        await driver.close()
        await flushPromises()
    })

    test('apply schema delta, check if it has been applied and pass integrity checks', async () => {
        const driver = await init()

        const changes = diffSchema({}, simpleSchema)
        await driver.applySchemaDelta(changes)
        const schema = await driver.getCurrentSchema()
        expect(schemaEquals(schema, simpleSchema)).toBe(true)
        await driver.performIntegrityCheck()

        await driver.close()
        await flushPromises()
    })

    test('complex schema, apply schema and perform insert, query, delete and update operations', async () => {
        const driver = await init()

        await driver.applySchema(complexSchema)

        const valueToInsert = {
            name: "test",
            password: "********",
            verified: true,
            bio: "some bio",
            level: 2,
            balance: 105.3
        }
        const userSelector: ResponseSelector = Object.fromEntries(Object.entries(valueToInsert).map(([key]) => [key, true]))

        const elementsBeforeInsertion = await driver.query("user", { selector: userSelector })
        expect(elementsBeforeInsertion.length).toBe(0)

        const { id } = await driver.insert("user", valueToInsert)

        const insertedValues = await driver.query("user", {
            selector: userSelector
        })

        expect(insertedValues).toEqual([{ ...valueToInsert, id }])
        valueToInsert.bio = "another bio"

        await driver.update("user", {
            operations: { "bio": { $set: valueToInsert.bio } }
        })
        const updatedValues = await driver.query("user", {
            selector: userSelector
        })
        expect(updatedValues).toEqual([valueToInsert])

        await driver.delete("user", {})
        const elementsAfterDeletion = await driver.query("user", { selector: {} })

        expect(elementsAfterDeletion.length).toBe(0)

        await driver.close()
        await flushPromises()
    })
    test('filters', async () => {
        const driver = await init()

        await driver.applySchema(complexSchema)

        const idA = await driver.insert("user", {
            name: "a",
            password: "***",
            verified: true,
            bio: "some bio",
            level: 1,
            balance: 0
        })
        const idB = await driver.insert("user", {
            name: "b",
            password: "",
            verified: false,
            bio: "short bio",
            level: 9001,
            balance: 13.69
        })
        const idC = await driver.insert("user", {
            name: "c",
            password: "secret",
            verified: false,
            bio: "short bio",
            level: 12,
            balance: 3
        })

        const filtered1 = await driver.query("user", {
            selector: true,
            filter: { "name": { $eq: "b" } }
        })
        expect(filtered1).toEqual([idB])

        const filtered2 = await driver.query("user", {
            selector: true,
            filter: { "level": { $gt: 1 } },
            sort: [ "id+" ]
        })
        expect(filtered2).toEqual([idB, idC])

        const filtered3 = await driver.query("user", {
            selector: true,
            filter: { "level": { $gte: 12} },
            sort: [ "id+" ]
        })
        expect(filtered3).toEqual([idB, idC])

        const filtered4 = await driver.query("user", {
            selector: true,
            filter: { "level": { $lt: 20 } },
            sort: [ "id+" ]
        })
        expect(filtered4).toEqual([idA, idC])

        const filtered5 = await driver.query("user", {
            selector: true,
            filter: { "level": { $lte: 1 } }
        })
        expect(filtered5).toEqual([idA])

        await driver.close()
        await flushPromises()
    })
})
