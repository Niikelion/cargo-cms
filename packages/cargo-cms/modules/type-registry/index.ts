import {makeModule} from "@cargo-cms/module-core";
import {DataType, Schema} from "@cargo-cms/database/schema";

const supportedTypes: Record<string, DataType> = {}

export type ComponentType = Schema & { type: "component" }
const definedComponents: Record<string, ComponentType> = {}

export type EntityType = Schema & { type: "entity" }
const definedEntities: Record<string, EntityType> = {}

const data = {
    registerDataType(type: DataType) {
        if (type.name in supportedTypes)
            throw new Error(`Data type ${type.name} is already registered`)

        supportedTypes[type.name] = type
    },
    getDataType(name: string): DataType | null {
        if (name in supportedTypes)
            return supportedTypes[name]

        return null
    },
    registerComponentType(component: ComponentType): void {
        if (component.name in definedComponents)
            throw new Error(`Component ${component.name} is already registered`)

        definedComponents[component.name] = component
    },
    getComponentType(name: string): ComponentType | null {
        if (name in definedComponents)
            return definedComponents[name]

        return null
    },
    registerEntityType(entity: EntityType): void {
        if (entity.name in definedEntities)
            throw new Error(`Entity ${entity.name} is already registered`)

        definedEntities[entity.name] = entity
    },
    getEntityType(name: string): EntityType | null {
        if (name in definedEntities)
            return definedEntities[name]

        return null
    },
    getAllEntityTypes() {
        return Object.values(definedEntities)
    }
}

const typeRegistry = makeModule("type-registry", {}, data)

export type TypeRegistryModule = typeof typeRegistry
export default typeRegistry