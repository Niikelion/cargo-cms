import {rest} from "../utils";
import {Express} from "express";
import {getEntities} from "../../operations/get";

export const registerRestApiPaths = (app: Express) => {
    app.get("/api/rest/:type", rest(async (req, res) => {
        //const entities = await getEntities(req.params.type)
        const entities = {}
        return { data: entities }
    }))
    app.put("/api/rest", rest(async (req, res) => {
        return {method: "put"}
    }))
    app.delete("/api/rest", rest(async (req, res) => {
        return {method: "delete"}
    }))
}