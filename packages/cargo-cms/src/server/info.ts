import {rest} from "./utils";
import {version} from "../version";
import express from "express";

export const registerInfoPath = (app: express.Express) => {
    app.get("/info", rest(async (req, res) => {
        return { version }
    }))
}