import express from 'express'
import {registerInfoPath} from "./info";
import {registerRestApiPaths} from "./api";
import {DataBase} from "../database/init";

export const runServer = (port: number, db: DataBase) => new Promise<void>(resolve => {
    const app = express()

    registerInfoPath(app)
    registerRestApiPaths(app, db)

    //TODO: proper welcome page in production, api explorer in development, nothing if disabled by config
    app.get("/", (_, res) => res.send("Running"))

    app.listen(port, () => {
        console.log(`Server running at "http://localhost:${port}"`)
    })

    resolve()
})