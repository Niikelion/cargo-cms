import {DataType, Schema} from "./types";

const supportedTypes: Record<string, DataType> = {}

export const registerDataType = (type: DataType): void => {
    if (type.name in supportedTypes)
        throw new Error(`Data type ${type.name} is already registered`)

    supportedTypes[type.name] = type
}

export const getDataType = (name: string): DataType | null => {
    if (name in supportedTypes)
        return supportedTypes[name]

    return null
}

export type ComponentType = Schema & { type: "component" }
const definedComponents: Record<string, ComponentType> = {}

export const registerComponentType = (component: ComponentType): void => {
    if (component.name in definedComponents)
        throw new Error(`Component ${component.name} is already registered`)

    definedComponents[component.name] = component
}

export const getComponentType = (name: string): ComponentType | null => {
    if (name in definedComponents)
        return definedComponents[name]

    return null
}

export type EntityType = Schema & { type: "entity" }
const definedEntities: Record<string, EntityType> = {}

export const registerEntityType = (entity: EntityType): void => {
    if (entity.name in definedEntities)
        throw new Error(`Entity ${entity.name} is already registered`)

    definedEntities[entity.name] = entity
}

export const getEntityType = (name: string): EntityType | null => {
    if (name in definedEntities)
        return definedEntities[name]

    return null
}

export const getAllEntityTypes = () => Object.values(definedEntities)