import {FieldFetcher, Structure, StructureField, TableJoin} from "./types";

type Joins = Record<string, TableJoin>
type SimpleType = StructureField & { type: "string" | "number" | "boolean" }
type ArrayType = StructureField & { type: "array" }
type ObjectType = StructureField & { type: "object" }
type ObjectUploadInType = ObjectType["upload"] & { type: "inwards" }
type ObjectUploadOutType = ObjectType["upload"] & { type: "outwards" }
type ObjectUploadCustomType = ObjectType["upload"] & { type: "custom" }
type CustomType = StructureField & { type: "custom" }

export const structureBuilder = {
    structure(content: StructureField, joins?: Joins): Structure {
        return {
            data: content,
            joins: joins ?? {}
        } satisfies Structure
    },
    simpleType(type: "string" | "number" | "boolean", dbPath: string): SimpleType {
        return {
            type,
            id: dbPath
        } satisfies SimpleType
    },
    array(elementType: StructureField, args: {
        joins?: Joins,
        fetch: FieldFetcher,
        upload: ArrayType["upload"]
    }): ArrayType {
        return {
            type: "array",
            data: elementType,
            joins: args.joins ?? {},
            fetch: args.fetch,
            upload: args.upload
        } satisfies ArrayType
    },
    object(fields: Record<string, StructureField>, args?: {
        upload?: ObjectType["upload"]
        fetch: FieldFetcher
        joins?: Joins
    }): ObjectType {
        if (args === undefined)
            return {
                type: "object",
                fields
            } satisfies ObjectType

        return {
            type: "object",
            fields,
            upload: args.upload,
            fetch: args.fetch,
            joins: args.joins ?? {}
        } satisfies ObjectType
    },
    objectUploadIn(linkedTable: string, getLinkData: ObjectUploadInType["getLinkData"]): ObjectUploadInType {
        return {
            type: "inwards",
            table: linkedTable,
            getLinkData
        } satisfies ObjectUploadInType
    },
    objectUploadOut(getLinkData: ObjectUploadOutType["getLinkData"]): ObjectUploadOutType {
        return {
            type: "outwards",
            getLinkData
        } satisfies ObjectUploadOutType
    },
    objectUploadCustom(upload: ObjectUploadCustomType["upload"]): ObjectUploadCustomType {
        return {
            type: "custom",
            upload
        } satisfies  ObjectUploadCustomType
    },
    custom(args: {
        fetch: CustomType["fetch"]
        upload: CustomType["upload"]
    }): CustomType {
        return {
            type: "custom",
            ...args
        } satisfies CustomType
    }
}