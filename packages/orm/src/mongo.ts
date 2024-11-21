import { QueryOptions, UpdateOptions, DeleteOptions } from "./operations";
import {TypeSchema, TypesSchema} from "./schema";
import {DatabaseDriver, EntityResponse, EntityResponseBase} from "./types";
import {applyDiffToTypeSchema, Diff, Json} from "./utils";
import {Collection, Db, MongoClient, MongoClientOptions, ObjectId, WithId} from "mongodb";
import deepEqual from "deep-equal";
import {cargoToMongoSchema} from "./mongoUtils";


type MongoDriverConfig = {
    mongoUrl: string
    clientOptions?: MongoClientOptions
    disableCollectionSchemaChecks?: boolean
}

type SchemaEntry = WithId<TypeSchema>

const escapeMongoName = (name: string) => name.replace(/\./g, "#")

export class MongoDriver implements DatabaseDriver {
    private readonly config: MongoDriverConfig
    private client: MongoClient | null = null
    private _db: Db | null = null
    private schemas: TypesSchema = {}
    private schemaCollection: Collection<SchemaEntry> | null = null

    constructor(config: MongoDriverConfig) {
        this.config = config
    }

    async init(): Promise<void> {
        const client = new MongoClient(this.config.mongoUrl, this.config.clientOptions)
        this.client = await client.connect()

        this.schemaCollection = await this.db.createCollection<SchemaEntry>("@schema", {})
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
        const schemaCollection = this.getSchemaCollection()

        //update schema registry
        await schemaCollection.deleteMany({})
        await schemaCollection.insertMany(Object.values(types).map(t => ({...t, _id: new ObjectId()})))

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
            if (!this.config.disableCollectionSchemaChecks) {
                const mismatchCount = await collection.countDocuments({$nor: [cargoToMongoSchema(type)]})
                if (mismatchCount > 0)
                    throw new Error(`Found documents in database that do not conform to the ${typeName} definition`)
            }
        }

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
    query(entityName: string, options: QueryOptions): Promise<EntityResponse[]> {
        throw new Error("Method not implemented.")
    }
    async insert(entityName: string, data: Json): Promise<EntityResponseBase> {
        const schema = this.getSchema(entityName)

        const collectionName = escapeMongoName(schema.name)
        const collection = this.db.collection(collectionName)

        const a = await collection.insertOne({
            _id: new ObjectId(),
            value: data
        })

        return { id: a.insertedId }
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
    private getSchemaCollection() {
        if (this.schemaCollection === null)
            throw new Error("Client not initialized")

        return this.schemaCollection
    }
    private async getSchemasFromDb() {
        const schemaCollection = this.getSchemaCollection()

        const existingSchemas = await schemaCollection.find().toArray()

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
}
