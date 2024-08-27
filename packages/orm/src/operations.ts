//export type ResponseSelector = true | string | { [k: string]: ResponseSelector } | (string | { [k: string]: ResponseSelector })[]
import {PrimitiveType} from "./schema";
import {Json, JsonObject} from "./utils";

export type ResponseSelector = true | { [k: string]: ResponseSelector }

export type ComparisonOperationFilterType =
    | { $eq: PrimitiveType }
    | { $neq: PrimitiveType }
    | { $lt: PrimitiveType }
    | { $lte: PrimitiveType }
    | { $gt: PrimitiveType }
    | { $gte: PrimitiveType }
    | { $like: PrimitiveType }
    | { $null: boolean }
    | { $in: PrimitiveType[] }
    | { $between: [PrimitiveType, PrimitiveType] }

export type CombineOperationFilterType =
    | { $not: FilterType }
    | { $and: FilterType[] }
    | { $or: FilterType[] }

export type FilterType =
    | { [k: string]: ComparisonOperationFilterType }
    | CombineOperationFilterType

export type SortType = string[] | string

export type OperationUpdateType =
    | { $set: PrimitiveType }
    | { $insert: {
        at: number,
        value: JsonObject
    } }
    | { $delete: number }

export type UpdateType = { [k: string]: OperationUpdateType }

export type QueryOptions = {
    selector: ResponseSelector
    filter?: FilterType
    sort?: SortType
    limit?: number
    offset?: number
}
export type UpdateOptions = {
    operations: UpdateType
    filter?: FilterType
}
export type DeleteOptions = {
    filter?: FilterType
}
