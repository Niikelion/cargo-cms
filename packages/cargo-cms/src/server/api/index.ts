import {rest} from "../utils";
import {Express} from "express";
import * as url from "url"
import * as qs from "qs"
import {getEntities} from "../../operations/get";
import {DataBase} from "../../database/init";
import {SelectorStructure} from "@cargo-cms/database/schema";

export const registerRestApiPaths = (app: Express, db: DataBase) => {
    app.use("/api/rest", (req, res, next) => {
        const query = url.parse(req.url).query ?? ""
        req.query = qs.parse(query, { ignoreQueryPrefix: true, depth: 20, allowDots: true })
        next()
    })

    app.get("/api/rest/:type", rest(async (req, res) => {
        const entities = await getEntities(db, req.params.type, req.query.select as SelectorStructure)
        return { data: entities }
    }))
    app.put("/api/rest", rest(async (req, res) => {
        return {method: "put"}
    }))
    app.delete("/api/rest", rest(async (req, res) => {
        return {method: "delete"}
    }))
}