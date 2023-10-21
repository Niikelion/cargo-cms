export const isDefined = <T>(v: T | undefined | null): v is T => v !== undefined && v !== null

export const isNumber = (v: unknown): v is number => typeof v === "number"

export const isBool = (v: unknown): v is boolean => typeof v === "boolean"