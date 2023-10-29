import express from "express";

export type JSONValue =
    | string
    | number
    | boolean | null
    | { [x: string]: JSONValue }
    | Array<JSONValue>;

export type RestFunction = (req: express.Request, res: express.Response) => Promise<JSONValue>