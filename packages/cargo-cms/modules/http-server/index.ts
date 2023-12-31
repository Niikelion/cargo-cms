import express from 'express'
import {registerInfoPath} from "./info";
import {makeModule, ModuleContext} from "@cargo-cms/modules-core";

const app = express()

let context: ModuleContext | null = null

const data = {
    app,
    stop: async () => {},
    start: async (port: number) => {
        if (context === null)
            throw new Error("Http server not initialized")

        //TODO: proper welcome page in production, api explorer in development, nothing if disabled by config
        app.get("/", (_, res) => res.send("Running"))

        registerInfoPath(app)

        const server = app.listen(port, () => {
            console.log(`Server running at "http://localhost:${port}"`)
        })

        data.stop = () => new Promise<void>((resolve, reject) => {
            server.close(err => {
                if (err !== undefined)
                    reject(err)
                else
                    resolve()
            })
        })
    }
}

const httpServerModule = makeModule("http-server", {
    init(ctx: ModuleContext) { context = ctx }
}, data)
export type HttpServerModule = typeof httpServerModule
export default httpServerModule