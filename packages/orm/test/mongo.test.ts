import {setupDriversTest} from "./shared";
import {MongoDriver} from "../src";
import {MongoClient} from "mongodb";

setupDriversTest([
    {
        factory: async () => {
            const url = "mongodb://cargo:cargo@localhost:20000/"

            const client = new MongoClient(url)
            await client.connect()

            const db = client.db("cargo-cms")
            const collections = await db.listCollections().toArray()

            for (const collection of collections) {
                await db.collection(collection.name).drop()
            }
            await client.close()

            return new MongoDriver({
                mongoUrl: url,
            });
        },
        name: "Mongo"
    }
])
