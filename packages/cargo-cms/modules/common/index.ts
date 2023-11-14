import {makeModule} from "@cargo-cms/module-core";
import {TypeRegistryModule} from "../type-registry";
import {registerBasicDataTypes} from "./basicDataTypes";
import {registerAdvancedDataTypes} from "./advancedDataTypes";

export default makeModule("common", {
    async init(modules) {
        const typeRegistry = await modules.require<TypeRegistryModule>("type-registry")
        registerAdvancedDataTypes(typeRegistry)
        registerBasicDataTypes(typeRegistry)
    }
}, {})