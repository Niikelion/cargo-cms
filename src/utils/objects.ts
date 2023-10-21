export const pick = <T extends object, Key extends keyof T>(v: T, keys: Key[]): Pick<T, Key> => {
    const ret = {} as Pick<T, Key>

    for (const p of keys) {
        ret[p] = v[p]
    }

    return ret
}