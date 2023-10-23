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

const root = path.resolve(`./example`)

const main = async () => {
    const schemaFiles = await readSchema(path.resolve(root, `src/schema`))

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

    const db = await createDatabase(path.resolve(root, `src/database.js`))

    try {
        for (const entity of getAllEntityTypes()) {
            await db.constructTable(entity)
        }
    } finally {
        await db.finish()
    }
}

main().catch(console.error)