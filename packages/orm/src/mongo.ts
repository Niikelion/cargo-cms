import { QueryOptions, UpdateOptions, DeleteOptions } from "./operations";
import { TypesSchema } from "./schema";
import {DatabaseDriver, EntityResponse, EntityResponseBase} from "./types";
import {Diff, Json} from "./utils";

export class MongoDriver implements DatabaseDriver {
    constructor() {
        //TODO:
    }

    performIntegrityCheck(): Promise<void> {
        throw new Error("Method not implemented.");
    }
    init(): Promise<void> {
        throw new Error("Method not implemented.");
    }
    close(): Promise<void> {
        throw new Error("Method not implemented.");
    }
    applySchema(types: TypesSchema): Promise<void> {
        throw new Error("Method not implemented.");
    }
    applySchemaDelta(changes: Diff): Promise<void> {
        throw new Error("Method not implemented.");
    }
    getCurrentSchema(): Promise<TypesSchema> {
        throw new Error("Method not implemented.");
    }
    query(entityName: string, options: QueryOptions): Promise<EntityResponse[]> {
        throw new Error("Method not implemented.");
    }
    insert(entityName: string, data: Json): Promise<EntityResponseBase> {
        throw new Error("Method not implemented.");
    }
    update(entityName: string, options: UpdateOptions): Promise<void> {
        throw new Error("Method not implemented.");
    }
    delete(entityName: string, options: DeleteOptions): Promise<EntityResponseBase[]> {
        throw new Error("Method not implemented.");
    }
}
