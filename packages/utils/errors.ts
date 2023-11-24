import {ZodError, ZodIssue} from "zod";
import {isNumber} from "./filters";

const stringifyZodIssue = (issue: ZodIssue): string =>
    `${issue.path.reduce((path: string, part: string | number) => {
        const p = isNumber(part) ? `[${part}]` : `${path.length > 0 ? '.' : ''}${part}`
        
        return path + p
    }, "")}: ${issue.message}`

export const stringifyZodError = (error: ZodError): string =>
    error.issues.map(stringifyZodIssue).join("\n")