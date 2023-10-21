import * as fs from "fs/promises";
import path from "path";

export const findFilesRecursive = async (dir: string): Promise<string[]> => {
    const list = await fs.readdir(dir)

    const result = await Promise.all(list.map(async file => {
        if (!file) return [] as string[]

        const resolvedPath = path.resolve(dir, file);

        const stat = await fs.stat(resolvedPath)

        if (stat.isFile())
            return [resolvedPath]

        return await findFilesRecursive(resolvedPath)
    }))

    return result.flat()
};