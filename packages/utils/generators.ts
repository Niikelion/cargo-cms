export const nameGenerator = (prefix: string) => function (strings: TemplateStringsArray, ...args: any[]) {
    return `${prefix}_${String.raw({raw: strings}, ...args)}`
}