import {makeModule, ModuleContext} from "@cargo-cms/modules-core";
import * as z from "zod";
import {FilterType, SelectorStructure, SortType} from "@cargo-cms/database/schema";
import express, {Express} from "express";
import {QueriesModule} from "../queries";
import {URL} from "url";
import qs from "qs";
import {rest} from "../http-server/utils";
import {JSONValue} from "@cargo-cms/utils/types";
import {HttpServerModule} from "../http-server";
import {stringifyZodError} from "@cargo-cms/utils/errors";

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
    params: z.object({
       type: z.string()
    }),
    query: z.object({
        select: selectorType,
        filter: filterType.optional(),
        limit: z.number().int().min(1).optional(),
        sort: sortType.optional()
    })
})

const restApiModule = makeModule("rest-api", {
    async init(ctx) {
        const [queries, { app }] = await ctx.requireMany<[QueriesModule, HttpServerModule]>(["queries", "http-server"])

        const restApi = express()

        restApi.set('query parser', (str: string) => qs.parse(str, { ignoreQueryPrefix: true, depth: 20, allowDots: true }))

        restApi.get("/:type", rest<Record<string, JSONValue>>(async req => {
            const request = getRequestType.safeParse(req)

            if (!request.success)
                throw new Error(stringifyZodError(request.error))

            const {params: { type }, query: {select, ...rest}} = request.data

            const entities = await queries.get(type, select, rest)
            return { data: entities }
        }))
        app.put("/", rest(async (req, res) => {
            return {method: "put"}
        }))
        app.delete("/", rest(async (req, res) => {
            return {method: "delete"}
        }))

        app.use("/api/rest", restApi)
    }
}, {})

export type RestApiModule = typeof restApiModule
export default restApiModule