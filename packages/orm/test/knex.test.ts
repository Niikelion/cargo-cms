import {describe, expect, test} from "vitest"
import fs from "fs/promises"
import {DataSchema, diffSchema, KnexDriver, schemaEquals, TypesSchema} from "../src";

const driverNames = ["sqlite"] as const
const drivers = driverNames.map(driverName => ({ driverName }))

const flushPromises = () => new Promise(r => setTimeout(r));

const stringType: DataSchema = { type: "string" }
const textType: DataSchema = { type: "text" }
const booleanType: DataSchema = { type: "boolean" }
const integerType: DataSchema = { type: "integer" }
const doubleType: DataSchema = { type: "double" }
const linkField = (target: string): DataSchema => ({ type: "relation", target, multiple: false, bidirectional: false })

//TODO: after adding new high-level drivers generalize this test to work for them too
describe.each(drivers)(`knex database driver for $driverName`, async ({driverName}) => {
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

    const createDriver = async (): Promise<KnexDriver> => {
        switch (driverName) {
            case "sqlite":
                await fs.rm("./test/db.sqlite", {force: true})
                return new KnexDriver({
                    client: "sqlite3",
                    connection: { filename: "./test/db.sqlite" },
                    useNullAsDefault: true
                })
        }
    }

    const init = async () => {
        const driver = await createDriver()
        await driver.init()
        return driver
    }

    test('empty run with integrity check', async () => {
        const driver = await createDriver()

        await expect(driver.init()).resolves.toBe(undefined)
        await expect(driver.performIntegrityCheck()).resolves.toBe(undefined)
        await expect(driver.close()).resolves.toBe(undefined)

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

    test.todo('complex schema, apply schema and perform insert, query, delete and update operations', async () => {
        const driver = await init()

        await driver.applySchema(complexSchema)

        await driver.close()
        await flushPromises()
    })
})
