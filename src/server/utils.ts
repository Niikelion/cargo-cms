import {RestFunction} from "./types";
import express from "express";

export class RestApiError extends Error {
    readonly code: number

    constructor(message: string, code: number) {
        super(message);
        this.code = code
    }
}

export const rest = (restFunction: RestFunction) =>
    (req: express.Request, res: express.Response) =>
        restFunction(req, res).then(value => res.json(value)).catch(err => {
            if (err instanceof RestApiError)
                res.status(err.code)

            res.json({ error: err.toString() })
        })