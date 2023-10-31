import {readSchema} from "./schema/reader";
import {
    ComponentType,
    constructSchema,
    EntityType,
    getAllEntityTypes,
    registerComponentType,
    registerEntityType
} from "./schema";
import {createDatabase} from "./database/init";
import path from "path";
import {runServer} from "./server";
import {getEntities} from "./operations/get";

const root = path.resolve(`./example`)

const useServer = false

const main = async () => {
    console.log("Loading schemas")
    const schemaFiles = await readSchema(path.resolve(root, `src/schema`))

    console.log("Constructing internal representation")
    const schemas = schemaFiles.map(constructSchema)

    schemas.forEach(schema => {
        switch (schema.type) {
            case "component": {
                registerComponentType(schema as ComponentType)
                break
            }
            case "entity": {
                registerEntityType(schema as EntityType)
                break
            }
            default: break
        }
    })
    console.log("Done")

    console.log("Initializing database")
    const db = await createDatabase(path.resolve(root, `src/database.js`))

    try {
        console.log("Constructing tables")
        await db.constructTables(getAllEntityTypes())
        console.log("Done")

        if (useServer) {
            console.log("Running backend server")
            await runServer(3000)
        } else {
            await getEntities(db.raw, "restaurant", {
                name: true,
                reviews: ["text", "author"]
            })
        }

    } finally {
        await db.finish()
    }
}

main().catch(console.error)