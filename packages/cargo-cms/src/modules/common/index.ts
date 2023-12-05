import {makeModule} from "@cargo-cms/modules-core";
import {TypeRegistryModule} from "../type-registry";
import {registerBasicDataTypes} from "./basicDataTypes";
import {DebugModule} from "../debug";
import {registerComponentDataType} from "./advanced/component";
import {registerRelationDataType} from "./advanced/relation";
import {registerDynamicComponentDataType} from "./advanced/dynamicComponent";

export default makeModule("common", {
    async init(modules) {
        const [typeRegistry, debug] = await modules.requireMany<[TypeRegistryModule, DebugModule]>("type-registry", "debug")

        registerBasicDataTypes(typeRegistry)
        registerComponentDataType(typeRegistry)
        registerRelationDataType(typeRegistry, debug)
        registerDynamicComponentDataType(typeRegistry, debug)
    }
}, {})