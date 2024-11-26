export const pick = <T extends object, Key extends keyof T>(v: T, keys: Key[]): Pick<T, Key> => {
    const ret = {} as Pick<T, Key>

    for (const p of keys) {
        ret[p] = v[p]
    }

    return ret
}

export const mapRecord = <Key extends string | symbol, Value extends any, Result extends any>(source: Record<Key, Value>, map: (v: Value, k: Key) => Result): Record<Key, Result> =>
    (Object.fromEntries(Object.entries<Value>(source).map(([key, value]) => [key, map(value, key as Key)])) as Record<Key, Result>)
