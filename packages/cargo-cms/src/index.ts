import {readSchema} from "../modules/schema-loader/reader";
import * as path from "path";
import {modules, Module} from "@cargo-cms/modules-core";
import {
    typeRegistryModule,
    ComponentType,
    EntityType,
    commonModule,
    schemaLoaderModule,
    queriesModule,
    httpServerModule,
    databaseModule,
    restApiModule
} from "../modules"

const root = path.resolve(process.cwd())

const useServer = false

const builtInModules: Module[] = [
    typeRegistryModule,
    commonModule,
    schemaLoaderModule,
    queriesModule,
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
    const schemas = schemaFiles.map(schemaLoaderModule.fromJson)

    schemas.forEach(schema => {
        switch (schema.type) {
            case "component": {
                typeRegistryModule.registerComponentType(schema as ComponentType)
                break
            }
            case "entity": {
                typeRegistryModule.registerEntityType(schema as EntityType)
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
        await databaseModule.constructTables(typeRegistryModule.getAllEntityTypes())
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
            // const res = await queriesModule.get("restaurant", ["*", { reviews: "*" }], {
            //     filter: { "name": { "#eq": "Test" } },
            //     sort: [ "name" ]
            // })
            // console.dir(res, {depth: 10})
            await queriesModule.insert("restaurant", {
                name: "Test2",
                reviews: [],
                tags: [ { name: "Bad" } ]
            })
            await queriesModule.delete("restaurant", { name: { "!eq": "Test2" } })
        }

    } finally {
        console.log("Unloading modules")
        await modules.cleanup()

        console.log("Closing database")
        await databaseModule.finish()
    }
}

main().catch(console.error)