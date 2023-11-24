import {makeModule} from "@cargo-cms/modules-core";
import {TypeRegistryModule} from "../type-registry";
import {registerBasicDataTypes} from "./basicDataTypes";
import {registerAdvancedDataTypes} from "./advancedDataTypes";
import {DebugModule} from "../debug";

export default makeModule("common", {
    async init(modules) {
        const [typeRegistry, debug] = await modules.requireMany<[TypeRegistryModule, DebugModule]>("type-registry", "debug")
        registerAdvancedDataTypes(typeRegistry, debug)
        registerBasicDataTypes(typeRegistry)
    }
}, {})