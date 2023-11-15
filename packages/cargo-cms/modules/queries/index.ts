import {makeModule} from "@cargo-cms/modules-core";
import {makeGet} from "./get";
import {makeDelete} from "./delete";
import {makeInsert} from "./insert";

const err = () => {
    throw new Error("Queries not initialized")
}

const data = {
    get: err as Awaited<ReturnType<typeof makeGet>>,
    delete: err as Awaited<ReturnType<typeof makeDelete>>,
    insert: err as Awaited<ReturnType<typeof makeInsert>>
}

const queriesModule = makeModule("queries", {
    async init(ctx) {
        data.get = await makeGet(ctx)
        data.delete = await makeDelete(ctx)
        data.insert = await makeInsert(ctx)
    }
}, data)

export type QueriesModule = typeof queriesModule
export default queriesModule