import {rest} from "../utils";
import {Express} from "express";
import { URL } from "url"
import qs from "qs";
import {FilterType, SortType, SelectorStructure} from "@cargo-cms/database/schema";
import {JSONValue} from "@cargo-cms/utils/types";
import * as z from "zod"
import {ModuleContext} from "@cargo-cms/module-core";
import {QueriesModule} from "../../queries";

const selectorType: z.ZodType<SelectorStructure> = z.union([
    z.string(),
    z.literal(true),
    z.union([z.string(), z.record(z.string(), z.lazy(() => selectorType))]).array(),
    z.record(z.string(), z.lazy(() => selectorType))
])

const filterType: z.ZodType<FilterType> = z.record(z.string(), z.union([
    z.lazy(() => filterType.array()),
    z.record(z.string(), z.union([
        z.string().array(),
        z.tuple([z.number(), z.number()]),
        z.string(),
        z.number(),
        z.boolean()
    ]))
]))

const sortType = z.union([
    z.string(),
    z.object({
        field: z.string(),
        desc: z.boolean().optional()
    })
]).array()

const getRequestType = z.object({
    type: z.string(),
    limit: z.number().int().min(1).optional(),
    sort: sortType.optional()
})

export const registerRestApiPaths = async (ctx: ModuleContext, app: Express) => {
    const queries = await ctx.require<QueriesModule>("queries")

    app.use("/api/rest", (req, res, next) => {
        const query = new URL(req.url).search ?? ""
        req.query = qs.parse(query, { ignoreQueryPrefix: true, depth: 20, allowDots: true })
        next()
    })

    app.get("/api/rest/:type", rest<Record<string, JSONValue>>(async (req, res) => {
        //TODO: data validation
        const entities = await queries.get(req.params.type as any as string, req.query.select as SelectorStructure, {
            filter: req.params.filter as any as FilterType,
            sort: req.params.sort as any as SortType[],
            limit: req.params.limit as any as number
        })
        return { data: entities }
    }))
    app.put("/api/rest", rest(async (req, res) => {
        return {method: "put"}
    }))
    app.delete("/api/rest", rest(async (req, res) => {
        return {method: "delete"}
    }))
}