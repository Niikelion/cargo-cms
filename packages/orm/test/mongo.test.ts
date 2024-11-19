import {setupDriversTest} from "./shared";
import {MongoDriver} from "../src/mongo";

setupDriversTest([
    {
        factory: async () => new MongoDriver(),
        name: "Mongo"
    }
])
