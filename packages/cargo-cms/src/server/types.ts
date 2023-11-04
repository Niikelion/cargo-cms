import express from "express";
import {JSONValue} from "@cargo-cms/utils/types"

export type RestFunction = (req: express.Request, res: express.Response) => Promise<JSONValue>