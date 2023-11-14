import {makeModule} from "@cargo-cms/module-core";
import {TypeRegistryModule} from "../type-registry";
import {makeGet} from "./get";

const err = () => {
    throw new Error("Queries not initialized")
}

const data = {
    get: err as Awaited<ReturnType<typeof makeGet>>
}

const queriesModule = makeModule("queries", {
    async init(ctx) {
        data.get = await makeGet(ctx)
    }
}, data)

export type QueriesModule = typeof queriesModule
export default queriesModule