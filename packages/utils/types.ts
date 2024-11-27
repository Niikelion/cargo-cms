export type JSONValue =
    | string
    | number
    | boolean | null
    | { [x: string]: JSONValue }
    | Array<JSONValue>;

export type Case<T extends string, V> = {
    type: T,
    value: V
}

export type DiscriminatedUnionToTypeMap<T extends Case<any, any>> = { [K in T["type"]]: Extract<T, {type: K}>["value"] }
