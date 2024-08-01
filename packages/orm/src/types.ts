import {Diff, Json} from "./utils";
import {TypesSchema} from "./schema";
import {DeleteOptions, QueryOptions, UpdateOptions} from "./operations";

export type DatabaseDriver = {
    /**
     * Performs database integrity check.
     * Looks for things like missing fields and unsatisfied constraints.
     */
    performIntegrityCheck(): Promise<void>
    /**
     * Initializes database connection and initializes driver.
     */
    init(): Promise<void>
    /**
     * End database connection and performs cleanup.
     */
    close(): Promise<void>
    /**
     * Applies new schema, overriding previous one.
     * @param types
     */
    applySchema(types: TypesSchema): Promise<void>
    /**
     * Applies changes to existing schema.
     * @param changes
     */
    applySchemaDelta(changes: Diff): Promise<void>
    /**
     * Retrieves current schema applied to the database.
     */
    getCurrentSchema(): Promise<TypesSchema>

    /**
     * Queries database with given options.
     * @param entityName
     * @param options
     */
    query(entityName: string, options: QueryOptions): Promise<Json[]>
    /**
     * Inserts single entry into database.
     * @param entityName
     * @param data
     */
    insert(entityName: string, data: Json): Promise<{id: number}>
    /**
     * Updates entries specified by filter by performing operations specified in update.
     * @param entityName
     * @param options
     */
    update(entityName: string, options: UpdateOptions): Promise<{id: number}[]>
    /**
     * Deletes entries from database using given filter.
     * @param entityName
     * @param options
     */
    delete(entityName: string, options: DeleteOptions): Promise<{id: number}[]>
}

