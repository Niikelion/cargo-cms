import {RestFunction} from "./types";
import express from "express";

export class RestApiError extends Error {
    readonly code: number

    constructor(message: string, code: number) {
        super(message);
        this.code = code
    }
}

export const rest = <Req extends object = Record<string, string>>(restFunction: RestFunction<Req>) =>
    (req: express.Request<Req>, res: express.Response) =>
        restFunction(req, res).then(value => res.json(value)).catch(err => {
            if (err instanceof RestApiError)
                res.status(err.code)

            res.json({ error: err.toString() })
        })