export const isDefined = <T>(v: T | undefined | null): v is T => v !== undefined && v !== null

export const isNumber = (v: unknown): v is number => typeof v === "number" || v instanceof Number

export const isBool = (v: unknown): v is boolean => typeof v === "boolean" || v instanceof Boolean

export const isString = (v: unknown): v is string => typeof v === "string" || v instanceof String

export const isArray = (v: unknown): v is unknown[] => Array.isArray(v)