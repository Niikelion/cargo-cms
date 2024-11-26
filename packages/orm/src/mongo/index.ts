import { QueryOptions, UpdateOptions, DeleteOptions } from "../operations";
import {TypeSchema, TypesSchema} from "../schema";
import {DatabaseDriver, EntityResponse, EntityResponseBase} from "../types";
import {applyDiffToTypeSchema, Diff, Json} from "../utils";
import {
    Collection,
    Db,
    MongoClient,
    MongoClientOptions,
    MongoServerError,
    ObjectId,
    WithId
} from "mongodb";
import deepEqual from "deep-equal";
import {
    cargoSelectorToMongoProjection,
    cargoToMongoSchema,
    escapeMongoName,
    toMongoValue,
    zodToMongoSchema
} from "./utils";
import {z} from "zod";


type MongoDriverConfig = {
    mongoUrl: string
    clientOptions?: MongoClientOptions
    disableCollectionSchemaChecks?: boolean
}

const CounterSchema = z.object({
    target: z.string(),
    index: z.number()
})
type CounterSchema = z.infer<typeof CounterSchema>

type SchemaEntry = WithId<TypeSchema>
type CounterEntry = WithId<CounterSchema>
type GenericEntry = { _id: number, value: any }

class CollectionsStore {
    readonly schema: Collection<SchemaEntry>
    readonly counters: Collection<CounterEntry>

    private constructor(schema: Collection<SchemaEntry>, counters: Collection<CounterEntry>) {
        this.schema = schema
        this.counters = counters
    }

    static async create(db: Db): Promise<CollectionsStore> {
        return new CollectionsStore(
            await db.createCollection<SchemaEntry>("@schema", {}),
            await db.createCollection<CounterEntry>("@counters", {
                validator: zodToMongoSchema(CounterSchema)
            })
        )
    }
}

export class MongoDriver implements DatabaseDriver {
    private readonly config: MongoDriverConfig
    private client: MongoClient | null = null
    private _db: Db | null = null
    private schemas: TypesSchema = {}
    private collections: CollectionsStore | null = null

    constructor(config: MongoDriverConfig) {
        this.config = config
    }

    async init(): Promise<void> {
        const client = new MongoClient(this.config.mongoUrl, this.config.clientOptions)
        this.client = await client.connect()

        this.collections = await CollectionsStore.create(this.db)
        this.schemas = await this.getSchemasFromDb()
    }
    async performIntegrityCheck(): Promise<void> {
        const existingSchemas = await this.getSchemasFromDb()

        const result = TypesSchema.safeParse(existingSchemas)

        if (!result.success) throw new Error("Invalid schema")

        const expectedKeys = new Set(Object.keys(this.schemas))

        for (const typeName in existingSchemas) {
            const schema = existingSchemas[typeName]

            if (!expectedKeys.delete(typeName))
                throw new Error(`Definition for ${typeName} exists in the database, but not in the current schema`)

            if (!deepEqual(this.schemas[typeName], schema))
                throw new Error(`Mismatch in ${typeName} definition between current schema and database`)

            if (!this.config.disableCollectionSchemaChecks) {
                const mongoSchema = cargoToMongoSchema(schema)

                const collection = this.db.collection(escapeMongoName(typeName))
                const mismatchCount = await collection.countDocuments({$nor: [mongoSchema]})

                if (mismatchCount > 0)
                    throw new Error(`Found documents in database that do not conform to the ${typeName} definition`)
            }
        }

        if (expectedKeys.size > 0)
            throw new Error(`Definition for ${expectedKeys.values().next().value} exists in the current schema, but not in the database`)
    }
    async close(): Promise<void> {
        if (this.client === null)
            return

        await this.client.close()
        this.client = null
        this._db = null
    }
    async applySchema(types: TypesSchema): Promise<void> {
        //update schema registry
        await this.schemaCollection.deleteMany({})
        await this.schemaCollection.insertMany(Object.values(types).map(t => ({...t, _id: new ObjectId()})))

        const existingCollections = new Set(Object.keys(this.schemas))

        //update all other collections
        for (const typeName in types) {
            const newType = !existingCollections.delete(typeName)

            const type = types[typeName]

            const collectionName = escapeMongoName(type.name)
            const mongoSchema = cargoToMongoSchema(type)

            if (newType) {
                await this.db.createCollection(collectionName, {validator: mongoSchema, validationLevel: "strict"})
            }
            else {
                await this.db.command({
                    collMod: collectionName,
                    validator: mongoSchema,
                    validationLevel: "strict"
                })
            }

            const collection = this.db.collection(collectionName)
            await collection.createIndex({ _id: 1 })

            if (!this.config.disableCollectionSchemaChecks) {
                const mismatchCount = await collection.countDocuments({$nor: [mongoSchema]})
                if (mismatchCount > 0)
                    throw new Error(`Found documents in database that do not conform to the ${typeName} definition`)
            }
        }

        //drop excess collections
        for (const typeName of existingCollections.values()) {
            await this.db.collection(escapeMongoName(typeName)).drop()
        }

        this.schemas = types
    }
    async applySchemaDelta(changes: Diff): Promise<void> {
        await this.applySchema(applyDiffToTypeSchema(this.schemas, changes))
    }
    async getCurrentSchema(): Promise<TypesSchema> {
        return this.schemas
    }
    async query(entityName: string, options: QueryOptions): Promise<EntityResponse[]> {
        const { schema, collection } = this.getCollection(entityName)

        const projection = cargoSelectorToMongoProjection(options.selector, schema, this.schemas)

        const result = await collection.find({
            //TODO: filter
        }, {
            projection: {
                value: projection
            },
            sort: undefined //TODO: sort
        }).toArray() as GenericEntry[]

        return result.map(v => ({ id: v._id, ...v.value }))
    }
    async insert(entityName: string, data: Json): Promise<EntityResponseBase> {
        const { schema, collection } = this.getCollection(entityName)

        const newId = await this.generateFreshId(schema)

        try {
             await collection.insertOne({
                _id: newId,
                value: toMongoValue(data, schema)
            })
        } catch (err) {
            if (err instanceof MongoServerError && err.code === 121)
                throw new Error(JSON.stringify(err.errInfo))
            throw err
        }

        return { id: newId }
    }
    update(entityName: string, options: UpdateOptions): Promise<void> {
        throw new Error("Method not implemented.")
    }
    delete(entityName: string, options: DeleteOptions): Promise<EntityResponseBase[]> {
        throw new Error("Method not implemented.")
    }

    get db() {
        if (this._db != null)
            return this._db

        if (this._db === null && this.client !== null) this._db = this.client.db("cargo-cms")

        if (this._db === null) throw new Error("Client not initialized")
        return this._db
    }
    private get schemaCollection() {
        if (this.collections === null)
            throw new Error("Client not initialized")

        return this.collections.schema
    }
    private async getSchemasFromDb() {
        const existingSchemas = await this.schemaCollection.find().toArray()

        const schemas: TypesSchema = {}

        existingSchemas.forEach(schema => {
            const { _id, ...rest } = schema
            return schemas[schema.name] = rest;
        })
        return schemas
    }
    private getSchema(entityName: string): TypeSchema {
        if (this.schemas === null)
            throw new Error("Client not initialized")

        if (entityName in this.schemas)
            return this.schemas[entityName]

        throw new Error(`Definition for ${entityName} not found`)
    }
    private async generateFreshId(schema: TypeSchema): Promise<number> {
        if (this.collections === null)
            throw new Error("Client not initialized")

        const collectionName = escapeMongoName(schema.name)

        const r = await this.collections.counters.findOneAndUpdate({ target: collectionName }, {
            $set: { target: collectionName },
            $inc: { index: 1 }
        }, { upsert: true, returnDocument: "after" })

        if (r === null) throw new Error("Failed to obtain index counter")

        return r.index
    }
    private getCollection(entityName: string) {
        const schema = this.getSchema(entityName)
        const collection = this.db.collection<GenericEntry>(schema.name)

        return {
            schema,
            collection
        }
    }
}
