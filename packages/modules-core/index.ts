export type ModuleContext = {
    register(m: Module): void
    init(): Promise<void>
    cleanup(): Promise<void>
    require<T extends Module>(name: T["__type"]): Promise<T>
    requireMany: <T extends [...Module[]]>(...names: { [K in keyof T]: T[K]["__type"] }) => Promise<T>
}

export type Module<Type extends string = string, Extension extends object = object> = {
    __type: Type
    init(ctx: ModuleContext): Promise<void> | void
    cleanup(): Promise<void> | void

    initialization: Promise<true>
} & Extension

const noop = () => {}

const registeredModules: { [Key in string]: Module<Key> } = {}

function requireMany<T extends [...Module[]]>(...names: { [K in keyof T]: T[K]["__type"] }): Promise<T> {
    return Promise.all(names.map(modules.require)) as Promise<T>
}

export const modules: ModuleContext = {
    register(m: Module) {
        if (m.__type in registeredModules)
            throw new Error("Module already registered")
        registeredModules[m.__type] = m
    },
    async init() {
        const moduleList = Object.values(registeredModules)

        await Promise.all(moduleList.map(m => m.init(modules)))
    },
    async cleanup() {
        const moduleList = Object.values(registeredModules)

        await Promise.all(moduleList.map(m => m.cleanup()))
    },
    async require<T extends Module>(name: string): Promise<T> {
        if (!(name in registeredModules))
            throw new Error(`Module ${name} not found`)
        const module = registeredModules[name]
        await module.initialization

        return module as T
    },
    requireMany: requireMany as ModuleContext["requireMany"]
}

export const makeModule = <Type extends string, Extension extends object>(name: Type, methods: Partial<Pick<Module, "init" | "cleanup">>, extension: Extension): Module<Type, Extension> => {
    let resolver: () => void = noop
    const initialization = new Promise<true>(resolve =>
        resolver = () => resolve(true))

    return Object.assign(extension, {
        __type: name,
        init: (ctx) => {
            const c: (ctx: ModuleContext) => (Promise<void> | void) = methods.init ?? noop
            const r = c(ctx)

            if (r instanceof Promise)
                return r.then(resolver)

            resolver()
        },
        cleanup: methods.cleanup ?? noop,
        initialization
    } satisfies Module<Type>)
}