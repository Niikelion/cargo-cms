import {readSchema} from "../modules/schema-loader/reader";
import * as path from "path";
import httpServerModule from "../modules/http-server";
import {modules, Module} from "@cargo-cms/modules-core";
import typeRegistry, {ComponentType, EntityType} from "../modules/type-registry";
import common from "../modules/common";
import schemaLoader from "../modules/schema-loader";
import queries from "../modules/queries";
import databaseModule from "../modules/database";
import restApiModule from "../modules/rest-api";

const root = path.resolve(process.cwd())

const useServer = true

const builtInModules: Module[] = [
    typeRegistry,
    common,
    schemaLoader,
    queries,
    httpServerModule,
    databaseModule,
    restApiModule
]

const main = async () => {
    console.log("Loading modules")
    builtInModules.forEach(modules.register)
    await modules.init()

    console.log("Loading schemas")
    const schemaFiles = await readSchema(path.resolve(root, `src/schema`))

    console.log("Constructing internal representation")
    const schemas = schemaFiles.map(schemaLoader.fromJson)

    schemas.forEach(schema => {
        switch (schema.type) {
            case "component": {
                typeRegistry.registerComponentType(schema as ComponentType)
                break
            }
            case "entity": {
                typeRegistry.registerEntityType(schema as EntityType)
                break
            }
            default: break
        }
    })
    console.log("Done")

    console.log("Initializing database")
    await databaseModule.setup(path.resolve(root, `src/database.js`))

    try {
        console.log("Constructing tables")
        await databaseModule.constructTables(typeRegistry.getAllEntityTypes())
        console.log("Done")

        if (useServer) {
            console.log("Running backend server")
            await httpServerModule.start(3000)

            await new Promise<void>(resolve => {
                process.stdin.resume()
                const end = () => resolve()

                process.on('exit', end)
                process.on('SIGINT', end)
                process.on('SIGKILL', end)
            })
            await httpServerModule.stop()
        } else {
            const res = await queries.get("restaurant", ["*", { reviews: "*" }], {
                filter: { "name": { "#eq": "Test" } },
                sort: [ "name" ]
            })
            console.dir(res, {depth: 10})
        }

    } finally {
        console.log("Unloading modules")
        await modules.cleanup()

        console.log("Closing database")
        await databaseModule.finish()
    }
}

main().catch(console.error)