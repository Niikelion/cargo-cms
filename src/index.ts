import {readSchema} from "./schema/reader";
import {constructSchema} from "./schema";
import {createDatabase} from "./database/init";
import path from "path";

const root = path.resolve(`./example`)

const main = async () => {
    const schemaFiles = await readSchema(path.resolve(root, `src/schema`))

    const schemas = schemaFiles.map(constructSchema)

    console.dir({schemas: schemas.map(schema => schema.name)}, {depth: 20})

    const db = await createDatabase(path.resolve(root, `src/database.js`))

    for (const schema of schemas) {
        await db.constructTable(schema)
    }

    await db.finish()
}

main().catch(console.error)