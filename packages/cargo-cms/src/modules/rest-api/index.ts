import {makeModule} from "@cargo-cms/modules-core";
import * as z from "zod";
import {FilterType, SelectorStructure} from "@cargo-cms/database/schema";
import express from "express";
import {QueriesModule} from "../queries";
import qs from "qs";
import {rest} from "../http-server/utils";
import {JSONValue, stringifyZodError} from "@cargo-cms/utils";
import {HttpServerModule} from "../http-server";

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

const putRequestType = z.object({
    params: z.object({
        type: z.string()
    }),
    body: z.record(z.string(), z.unknown())
})

const deleteRequestType = z.object({
    params: z.object({
        type: z.string()
    }),
    query: z.object({
        filter: filterType
    })
})

const data = {
    api: null as ReturnType<typeof express> | null
}

const restApiModule = makeModule("rest-api", {
    async init(ctx) {
        const [queries, { app }] = await ctx.requireMany<[QueriesModule, HttpServerModule]>("queries", "http-server")

        const restApi = express()
        restApi.use(express.json())

        restApi.set('query parser', (str: string) => qs.parse(str, { ignoreQueryPrefix: true, depth: 20, allowDots: true }))

        restApi.get("/:type", rest<Record<string, JSONValue>>(async req => {
            const request = getRequestType.safeParse(req)

            if (!request.success)
                throw new Error(stringifyZodError(request.error))

            const {params: { type }, query: {select, ...rest}} = request.data

            const entities = await queries.get(type, select, rest)
            return { data: entities }
        }))
        restApi.put("/:type", rest(async req => {
            const request = putRequestType.safeParse(req)

            if (!request.success)
                throw new Error(stringifyZodError(request.error))

            const {params: {type}, body} = request.data

            await queries.insert(type, body as JSONValue)

            return {}
        }))
        restApi.patch("/:type", rest(async req => {
            return {method: req.method}
        }))
        restApi.delete("/:type", rest<Record<string, JSONValue>>(async req => {
            const request = deleteRequestType.safeParse(req)

            if (!request.success)
                throw new Error(stringifyZodError(request.error))

            const {params: {type}, query: {filter}} = request.data

            const count = await queries.delete(type, filter)
            return {deleted: count}
        }))

        app.use("/api/rest", restApi)
        data.api = restApi
    }
}, data)

export type RestApiModule = typeof restApiModule
export default restApiModule