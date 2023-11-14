import express from "express";
import {JSONValue} from "@cargo-cms/utils/types"

export type RestFunction<Req extends object> = (req: express.Request<Req>, res: express.Response) => Promise<JSONValue>