import {PrimitiveType} from "./schema";
import {JsonObject} from "./utils";
import {DiscriminatedUnionToTypeMap} from "@cargo-cms/utils";

export type ResponseSelector = true | 1 | { [k: string]: ResponseSelector }

type COF<T extends string, V> = {
    type: T
    value: V
}
export type ComparisonOperationFilter =
    | COF<"$eq", PrimitiveType>
    | COF<"$neq", PrimitiveType>
    | COF<"$lt", PrimitiveType>
    | COF<"$lte", PrimitiveType>
    | COF<"$gt", PrimitiveType>
    | COF<"$gte", PrimitiveType>
    | COF<"$like", string>
    | COF<"$null", boolean>
    | COF<"$in", PrimitiveType[]>
    | COF<"$between", [PrimitiveType, PrimitiveType]>

export type ComparisonOperationFilterInput =
    | { $eq: PrimitiveType }
    | { $neq: PrimitiveType }
    | { $lt: PrimitiveType }
    | { $lte: PrimitiveType }
    | { $gt: PrimitiveType }
    | { $gte: PrimitiveType }
    | { $like: string }
    | { $null: boolean }
    | { $in: PrimitiveType[] }
    | { $between: [PrimitiveType, PrimitiveType] }

export type CombineOperationFilter =
    | COF<"$not", FilterType>
    | COF<"$and", FilterType[]>
    | COF<"$or", FilterType[]>

export type CombineOperationFilterInput =
    | { $not: FilterType }
    | { $and: FilterType[] }
    | { $or: FilterType[] }

export type FilterType =
    | { [k: string]: ComparisonOperationFilterInput }
    | CombineOperationFilterInput

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
