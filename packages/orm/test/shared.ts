import {describe, expect, test} from "vitest"
import {DatabaseDriver, DataSchema, diffSchema, ResponseSelector, schemaEquals, TypesSchema} from "../src";

type DriverFactory = () => Promise<DatabaseDriver>
type DriverData = {
    factory: DriverFactory,
    name: string
}

const flushPromises = () => new Promise(r => setTimeout(r));

const stringType: DataSchema = { type: "string" }
const textType: DataSchema = { type: "text" }
const booleanType: DataSchema = { type: "boolean" }
const integerType: DataSchema = { type: "integer" }
const doubleType: DataSchema = { type: "float" }
const linkField = (target: string): DataSchema => ({ type: "relation", target, toMultiple: false, bidirectional: false })

export const setupDriversTest = (drivers: DriverData[]) => {
    describe.each(drivers.map(data => ({ createDriver: data.factory, driverName: data.name })))(`$driverName database driver`, async ({createDriver}) => {
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
                    balance: doubleType,
                    tags: {
                        type: "array",
                        elements: {
                            type: "object",
                            fields: {
                                name: stringType
                            }
                        }
                    }
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

        const dbTest = test.extend<{driver: DatabaseDriver}>({
            driver: async ({}, use) => {
                const driver = await init()
                try {
                    await use(driver)
                } finally {
                    await driver.close()
                    await flushPromises()
                }
            }
        })

        dbTest('empty run with integrity check', async ({driver}) => {
            await driver.performIntegrityCheck()
        })
        dbTest('simple run, apply schema and pass integrity checks', async ({driver}) => {
            await driver.applySchema(simpleSchema)
            await driver.performIntegrityCheck()
        })
        dbTest('complex schema, apply schema using all table features and pass integrity checks', async ({driver}) => {
            await driver.applySchema(complexSchema)
            await driver.performIntegrityCheck()
        })
        dbTest('apply schema delta, check if it has been applied and pass integrity checks', async ({driver}) => {
            const changes = diffSchema({}, simpleSchema)
            await driver.applySchemaDelta(changes)
            const schema = await driver.getCurrentSchema()
            expect(schemaEquals(schema, simpleSchema)).toBe(true)
            await driver.performIntegrityCheck()
        })
        dbTest('complex schema, apply schema and perform insert, query, delete and update operations', async ({driver}) => {
            await driver.applySchema(complexSchema)

            const valueToInsert = {
                name: "test",
                password: "********",
                verified: true,
                bio: "some bio",
                level: 2,
                balance: 105.3,
                tags: [
                    {name: "author"},
                    {name: "admin"}
                ]
            }
            const userSelector: ResponseSelector = Object.fromEntries(Object.entries(valueToInsert).map(([key]) => [key, true]))
            userSelector["tags"] = {name: true}

            const elementsBeforeInsertion = await driver.query("user", {selector: userSelector})
            expect(elementsBeforeInsertion.length).toBe(0)

            const {id} = await driver.insert("user", valueToInsert)

            const insertedValues = await driver.query("user", {
                selector: userSelector
            })

            expect(insertedValues).toEqual([{...valueToInsert, id}])
            valueToInsert.bio = "another bio"
            valueToInsert.tags[0].name = "Author"

            await driver.update("user", {
                operations: {
                    "bio": {$set: valueToInsert.bio},
                    "tags.0.name": {$set: valueToInsert.tags[0].name}
                },
                filter: {"id": {$eq: id}}
            })
            const updatedValues = await driver.query("user", {
                selector: userSelector
            })
            expect(updatedValues).toEqual([{...valueToInsert, id}])

            await driver.delete("user", {})
            const elementsAfterDeletion = await driver.query("user", {selector: {}})

            expect(elementsAfterDeletion.length).toBe(0)
        })
        dbTest('filter operations', async ({driver}) => {
            await driver.applySchema(complexSchema)

            const idA = await driver.insert("user", {
                name: "a",
                password: "***",
                verified: true,
                bio: "some bio",
                level: 1,
                balance: 0,
                tags: []
            })
            const idB = await driver.insert("user", {
                name: "b",
                password: "",
                verified: false,
                bio: "short bio",
                level: 9001,
                balance: 13.69,
                tags: []
            })
            const idC = await driver.insert("user", {
                name: "c",
                password: "secret",
                verified: false,
                bio: "some other bio",
                level: 12,
                balance: 3,
                tags: []
            })

            const filtered1 = await driver.query("user", {
                selector: true,
                filter: {"name": {$eq: "b"}}
            })
            expect(filtered1).toEqual([idB])

            const filtered2 = await driver.query("user", {
                selector: true,
                filter: {"level": {$gt: 1}},
                sort: ["id+"]
            })
            expect(filtered2).toEqual([idB, idC])

            const filtered3 = await driver.query("user", {
                selector: true,
                filter: {"level": {$gte: 12}},
                sort: ["id+"]
            })
            expect(filtered3).toEqual([idB, idC])

            const filtered4 = await driver.query("user", {
                selector: true,
                filter: {"level": {$lt: 20}},
                sort: ["id+"]
            })
            expect(filtered4).toEqual([idA, idC])

            const filtered5 = await driver.query("user", {
                selector: true,
                filter: {"level": {$lte: 1}}
            })
            expect(filtered5).toEqual([idA])

            const filtered6 = await driver.query("user", {
                selector: true,
                filter: {"bio": {$neq: "short bio"}},
                sort: ["id+"]
            })
            expect(filtered6).toEqual([idA, idC])
        })
        dbTest('filtering across relations', async ({driver}) => {
            await driver.applySchema(complexSchema)

            const userIdA = await driver.insert("user", {
                name: "a",
                password: "***",
                verified: true,
                bio: "some bio",
                level: 1,
                balance: 0,
                tags: []
            })
            const userIdB = await driver.insert("user", {
                name: "b",
                password: "",
                verified: false,
                bio: "short bio",
                level: 9001,
                balance: 13.69,
                tags: []
            })

            const blogPostA = await driver.insert("blogPost", {
                author: userIdA.id
            })
            const blogPostB = await driver.insert("blogPost", {
                author: userIdB.id
            })

            const filtered1 = await driver.query("blogPost", {
                selector: true,
                filter: {"author.id": {$eq: userIdB.id}}
            })
            expect(filtered1).toEqual([blogPostB])

            const filtered2 = await driver.query("blogPost", {
                selector: true,
                filter: {"author.level": {$lt: 9001}}
            })
            expect(filtered2).toEqual([blogPostA])
        })
        dbTest.todo('sorting', async ({driver}) => {
            await driver.applySchema(simpleSchema)

            //TODO
        })
        dbTest.todo('deletes', async ({driver}) => {
            await driver.applySchema(simpleSchema)

            //TODO
        })
        dbTest('updates', async ({driver}) => {
            await driver.applySchema(complexSchema)

            const userIdA = await driver.insert("user", {
                name: "a",
                password: "***",
                verified: true,
                bio: "some bio",
                level: 1,
                balance: 0,
                tags: [{name: "user"}]
            })

            const userIdB = await driver.insert("user", {
                name: "b",
                password: "***",
                verified: true,
                bio: "some bio",
                level: 1,
                balance: 0,
                tags: [{name: "admin"}]
            })

            const blogPostIdA = await driver.insert("blogPost", {
                author: userIdB.id
            })

            // set simple field
            await driver.update("user", {
                operations: {
                    "password": {$set: "insecure"}
                },
                filter: {id: {$eq: userIdA.id}}
            })

            const updatedUser = await driver.query("user", {
                selector: true, filter: {id: {$eq: userIdA.id}}
            })
            expect(updatedUser).toEqual([userIdA])

            // set single field relation
            await driver.update("blogPost", {
                operations: {
                    "author": {$set: userIdA.id}
                }
            })

            const updatedBlogPost = await driver.query("blogPost", {
                selector: {
                    author: true
                }
            })

            expect(updatedBlogPost).toEqual([{...blogPostIdA, author: userIdA}])

            // don't allow updates through relations
            await expect(driver.update("blogPost", {
                operations: {"author.name": {$set: "new name"}},
                filter: {"id": {$eq: blogPostIdA.id}}
            })).rejects.toThrow()

            //TODO: handle multiple relations

            // insert into array
            await driver.update("user", {
                operations: {
                    "tags": {
                        $insert: {
                            at: 0, value: {name: "user"}
                        }
                    }
                },
                filter: {id: {$eq: userIdB.id}}
            })
            const updatedUserTags = await driver.query("user", {
                selector: { tags: { name: true } },
                filter: {id: {$eq: userIdB.id}}
            })
            expect(updatedUserTags, `Expect tag "user" to be inserted at position 0`).toEqual([{
                ...userIdB, tags: [{name: "user"}, {name: "admin"}]
            }])

            //delete from array
            await driver.update("user", {
                operations: {
                    "tags": {
                        $delete: 1
                    }
                },
                filter: {id: {$eq: userIdB.id}}
            })
            const updatedUserTags2 = await driver.query("user", {
                selector: { tags: { name: true } },
                filter: {id: {$eq: userIdB.id}}
            })
            expect(updatedUserTags2, `Expect tag at position 1 to be deleted`).toEqual([{
                ...userIdB, tags: [{name: "user"}]
            }])
        })
    })
}
