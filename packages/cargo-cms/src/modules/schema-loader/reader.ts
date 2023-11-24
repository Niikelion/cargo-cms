import {z} from "zod";
import {findFilesRecursive} from "@cargo-cms/utils/files";
import {stringifyZodError, isDefined} from "@cargo-cms/utils";
import * as fs from "fs/promises";

const entityTypeSchema = z.union([z.literal("entity"), z.literal("component")])

const entityDescriptionSchema = z.object({
    path: z.string(),
    description: z.string().optional(),
    icon: z.string().optional()
})

const fieldDescriptionSchema = z.object({
    path: z.string(),
    description: z.string().optional(),
    visible: z.boolean().optional(),
    order: z.number().optional()
})

export const fieldConstraintsSchema = z.object({
    required: z.boolean().optional(),
    unique: z.boolean().optional()
}).catchall(z.unknown())

const fieldSchema = z.object({
    name: z.string(),
    type: z.string(),
    constraints: fieldConstraintsSchema,
    description: fieldDescriptionSchema
})

export type SchemaFileFieldSchema = z.infer<typeof fieldSchema>

const schemaFileSchema = z.object({
    name: z.string(),
    type: entityTypeSchema,
    description: entityDescriptionSchema,
    fields: fieldSchema.array()
})

export type SchemaFile = z.infer<typeof schemaFileSchema>

export const readSchema = async (rootDirectory: string): Promise<SchemaFile[]> => {
    const files = await findFilesRecursive(rootDirectory)

    const jsonFiles = files.filter(file => file.endsWith(".json"))

    const result = await Promise.all(jsonFiles.map(async file => {
        const content = await fs.readFile(file)

        const result = schemaFileSchema.safeParse(JSON.parse(content.toString()))

        if (result.success)
            return result.data

        console.error(`Couldn't load schema file ${file}:\n${stringifyZodError(result.error)}`)

        return undefined
    }))

    return result.filter(isDefined)
}