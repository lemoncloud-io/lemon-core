# Cosmos DB
Azure Cosmos DB is a fully managed NoSQL and relational database for modern app development. Corresponds to aws dynamoDB

## Connect cosmos DB
### Install @azure/cosmos module
Azure Cosmos DB client library for JavaScript/TypeScript
This package is intended for JavaScript/TypeScript applications to interact with **SQL API** databases and the JSON documents they contain:

- Create Cosmos DB databases and modify their settings
- Create and modify containers to store collections of JSON documents
- Create, read, update, and delete the items (JSON documents) in your containers
- Query the documents in your database using SQL-like syntax


### Create an instance of CosmosClient
Interaction with Cosmos DB starts with an instance of the CosmosClient class
Use the URI and Key of the instance

```
const { CosmosClient } = require("@azure/cosmos");

const endpoint = "https://your-account.documents.azure.com";
const key = "<database account masterkey>";
const client = new CosmosClient({ endpoint, key });

async function main() {
  // The rest of the README samples are designed to be pasted into this function body
}

main().catch((error) => {
  console.error(error);
});
```
[Azure Cosmos DB client library for JavaScript | Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/overview/azure/cosmos-readme?view=azure-node-latest#read-an-item)
<br>
[Where to find Cosmos DB Endpoint and Key - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1056745/where-to-find-cosmos-db-endpoint-and-key)
<br>
[Learn how to secure access to data in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/secure-access-to-data?tabs=using-primary-key)
  
### Key concepts
Once you've initialized a CosmosClient, you can interact with the primary resource types in Cosmos DB:

- **Database**: A Cosmos DB account can contain multiple databases. When you create a database, you specify the API you'd like to use when interacting with its documents: SQL, MongoDB, Gremlin, Cassandra, or Azure Table. Use the Database object to manage its containers.
- **Container**: A container is a collection of JSON documents. You create (insert), read, update, and delete items in a container by using methods on the Container object.
- **Item**: An Item is a JSON document stored in a container. Each Item must include an id key with a value that uniquely identifies the item within the container. If you do not provide an id, the SDK will generate one automatically.

[@azure/cosmos - npm](https://www.npmjs.com/package/@azure/cosmos)
<br>
[Migrate your application from Amazon DynamoDB to Azure Cosmos DB | Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/dynamo-to-cosmos)
<br>
[Create a collection in Azure Cosmos DB for MongoDB | Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/how-to-create-container)

<br>

| Dynamo 	|   Cosmos  |
|---------|-----------|
| N/A     | Database  |
| Table   | Container <br> Collection(MongoDB) |

<br>

#### Create Database and Container in lemon-core
After authenticating your CosmosClient, you can work with any resource in the account. The code snippet below creates a SQL API database in lemon-core

<br>
  
```
public async createTable() {
        const { tableName, idName } = this.options;
        const { database } = await client.databases.createIfNotExists(
              { id: databaseName }); 
        const { container } = await   database.containers.createIfNotExists({ id: tableName });
}
```

```
export class CosmosStorageService<T extends StorageModel>  {
    public constructor(table: string, fields: string[], idName: string = 'id') {
        // Add
        this.$cosmos.createTable();
    }
    …
}

```

<br><br>

## Save, Read, Update and Delete

### Query the database
A Cosmos DB SQL API database supports querying the items in a container with Items.query using SQL-like syntax:

```
const { resources } = await container.items
  .query("SELECT * from c WHERE c.isCapitol = true")
  .fetchAll();
for (const city of resources) {
  console.log(`${city.name}, ${city.state} is a capitol `);
}
```
Perform parameterized queries by passing an object containing the parameters and their values to Items.query:
```
const { resources } = await container.items
  .query({
    query: "SELECT * from c WHERE c.isCapitol = @isCapitol",
    parameters: [{ name: "@isCapitol", value: true }]
  })
  .fetchAll();
for (const city of resources) {
  console.log(`${city.name}, ${city.state} is a capitol `);
}
```
**READ**:
To read a single item from a container, use Item.read. This is a less expensive operation than using SQL to query by id.

**SAVE**:
To insert items into a container, pass an object containing your data to Items.upsert. The Cosmos DB service requires each item has an id key. If you do not provide one, the SDK will generate an id automatically.
This example inserts several items into the container

**DELETE**:
To delete items from a container, use Item.delete.

**UPDATE**:
To update items from a container, use Item.replace.

[Azure Cosmos DB client library for JavaScript | Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/overview/azure/cosmos-readme?view=azure-node-latest#read-an-item)
<br>
[Github:azure-sdk-for-js](https://github.com/Azure/azure-sdk-for-js/blob/%40azure/cosmos_3.17.3/sdk/cosmosdb/cosmos/samples-dev/ItemManagement.ts)

<br>

### Metadata
Metadata keys for document records when using cosmos DB

|Property |	Description|
|---------|---------------|
| id	| Required. It is a user settable property. It is the unique name that identifies the document, that is, no two documents share the same ID within a logical partition. Partition and ID uniquely identifies an item in the database. The id field must not exceed 255 characters|
|_rid	| It is a system generated property. The resource ID (_rid) is a unique identifier that is also hierarchical per the resource stack on the resource model. It is used internally for placement and navigation of the document resource.|
|_ts	| It is a system generated property. It specifies the last updated timestamp of the resource. The value is a timestamp.|
|_self|	It is a system generated property. It is the unique addressable URI for the resource.|
|_etag|	It is a system generated property that specifies the resource etag required for optimistic concurrency control.|
|_attachments|	It is a system generated property that specifies the addressable path for the attachments resource.|


[Documents - Azure Cosmos DB REST API | Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/cosmos-db/documents)

### Error handling
The SDK generates various types of errors that can occur during an operation.

- ErrorResponse is thrown if the response of an operation returns an error code of >=400.
- TimeoutError is thrown if Abort is called internally due to timeout.
- AbortError is thrown if any user passed signal caused the abort.
- RestError is thrown in case of failure of underlying system call due to network issues.
- Errors generated by any devDependencies. For Eg. @azure/identity package could throw CredentialUnavailableError.

<br><br>

## Index

### From items to trees
Every time an item is stored in a container, its content is projected as a JSON document, then converted into a tree representation. 
This conversion means that every property of that item gets represented as a node in a tree.
The reason why Azure Cosmos DB transforms items into trees is because it allows the system to reference properties using their paths within those trees. 

### Types of indexes
- Range Index
- Spatial index
- Composite indexes

#### 1. Range Index
Range index is based on an ordered tree-like structure. The range index type is used for:
- Equality queries:

```
SELECT * FROM container c WHERE c.property = 'value'
SELECT * FROM c WHERE c.property IN ("value1", "value2", "value3")
```

- Equality match on an array element

```
SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "tag1")
```

- Range queries:
```
SELECT * FROM container c WHERE c.property > 'value'
# NOTE: (works for >, <, >=, <=, !=)
``` 
- Checking for the presence of a property:

```
SELECT * FROM c WHERE IS_DEFINED(c.property)
```
- String system functions:
```
SELECT * FROM c WHERE CONTAINS(c.property, "value")
SELECT * FROM c WHERE STRINGEQUALS(c.property, "value")
```
- ORDER BY queries:
```
SELECT * FROM container c ORDER BY c.property
```
- JOIN queries:

```
SELECT child FROM container c JOIN child IN c.properties WHERE child = 'value'
```


#### 2. Spatial index
Spatial indices enable efficient queries on geospatial objects such as - points, lines, polygons, and multipolygon. 
These queries use ST_DISTANCE, ST_WITHIN, ST_INTERSECTS keywords. The following are some examples that use spatial index type:

- Geospatial distance queries:
```
SELECT * FROM container c WHERE ST_DISTANCE(c.property, { "type": "Point", "coordinates": [0.0, 10.0] }) < 40
```
- Geospatial within queries:
```
SELECT * FROM container c WHERE ST_WITHIN(c.property, {"type": "Point", "coordinates": [0.0, 10.0] })
```
- Geospatial intersect queries:
```
SELECT * FROM c WHERE ST_INTERSECTS(c.property, { 'type':'Polygon', 'coordinates': [[ [31.8, -5], [32, -5], [31.8, -5] ]]  })  
```

#### 3. Composite indexes
Composite indexes increase the efficiency when you're performing operations on multiple fields. The composite index type is used for:

- ORDER BY queries on multiple properties:

```
SELECT * FROM container c ORDER BY c.property1, c.property2
```
- Queries with a filter and ORDER BY. These queries can utilize a composite index if the filter property is added to the ORDER BY clause.
```
SELECT * FROM container c WHERE c.property1 = 'value' ORDER BY c.property1, c.property2
```
- Queries with a filter on two or more properties were at least one property is an equality filter
```
SELECT * FROM container c WHERE c.property1 = 'value' AND c.property2 > 'value'
```

[Overview of indexing in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/index-overview)

<br><br>

## Indexing policies in Azure Cosmos DB
In Azure Cosmos DB, every container has an indexing policy that dictates how the container's items should be indexed. 
The default indexing policy for newly created containers indexes every property of every item and enforces range indexes for any string or number. 
This allows you to get good query performance without having to think about indexing and index management upfront. 
<br><br>
In some situations, you may want to override this automatic behavior to better suit your requirements. 
You can customize a container's indexing policy by setting its indexing mode, and include or exclude property paths.

### Indexing mode
Azure Cosmos DB supports two indexing modes:

**Consistent**: The index is updated synchronously as you create, update or delete items. 
This means that the consistency of your read queries will be the consistency configured for the account. 
<br>
**None**: Indexing is disabled on the container. This mode is commonly used when a container is used as a pure key-value store without the need for secondary indexes. 
It can also be used to improve the performance of bulk operations. After the bulk operations are complete, the index mode can be set to Consistent and then monitored using the IndexTransformationProgress until complete.


[Azure Cosmos DB indexing policies | Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy)
<br>
[Manage indexing policies in Azure Cosmos DB | Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-manage-indexing-policy?tabs=dotnetv3%2Cpythonv3)

### Query condition
In order for an item to be returned, an expression specified as a filter condition must evaluate to true. 
Only the boolean value true satisfies the condition, any other value: undefined, null, false, a number scalar, an array, or an object doesn't satisfy the condition.
<br>
If you include your partition key in the WHERE clause as part of an equality filter, your query automatically filters to only the relevant partitions.
<br>


**Arithmetic**: +,-,*,/,% <br>
**Bitwise**:  &, |, ^, <<, >>, >>> (zero-fill right shift) <br>
**Logical**: AND, OR, NOT <br>
**Comparison**: =, !=, <, >, <=, >=, <> <br>
**String**:  ||(concatenate) <br>

[WHERE clause (NoSQL query) - Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/where)

<br>

## Pagination

In Azure Cosmos DB for NoSQL, queries may have multiple pages of results. 
This document explains criteria that Azure Cosmos DB for NoSQL's query engine uses to decide whether to split query results into multiple pages. 
You can optionally use **continuation tokens** to manage query results that span multiple pages.

[Pagination - Azure Cosmos DB for NoSQL | Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/pagination)
<br>
[Cosmos db continuation token with order by creation date - Stack Overflow](https://stackoverflow.com/questions/68921240/cosmos-db-continuation-token-with-order-by-creation-date)


## Transactions

The database engine in Azure Cosmos DB supports full **ACID** (Atomicity, Consistency, Isolation, Durability) compliant transactions with snapshot isolation. 
All the database operations within the scope of a container's logical partition are transactionally executed within the database engine that is hosted by the replica of the partition. 
These operations include both write (updating one or more items within the logical partition) and read operations. 
The following table illustrates different operations and transaction types:


|Operation|	Operation Type	|Single or Multi Item Transaction|
|---------|-----------------|--------------------------------|
|Insert (without a pre/post trigger)	|Write	|Single item transaction|
|Insert (with a pre/post trigger)|	Write and Read	|Multi-item transaction|
|Replace (without a pre/post trigger)|	Write	|Single item transaction|
|Replace (with a pre/post trigger)|	Write and Read	|Multi-item transaction|
|Upsert (without a pre/post trigger)|	Write	|Single item transaction|
|Upsert (with a pre/post trigger)|	Write and Read	|Multi-item transaction|
|Delete (without a pre/post trigger)|	Write	|Single item transaction|
|Delete (with a pre/post trigger)|	Write and Read	|Multi-item transaction|
|Execute stored procedure|	Write and Read	|Multi-item transaction|
|System initiated execution of a merge procedure|	Write	|Multi-item transaction|
|System initiated execution of deleting items based on expiration (TTL) of an item|	Write	|Multi-item transaction|
|Read|	Read	|Single-item transaction|
|Change Feed|	Read	|Multi-item transaction|
|Paginated Read	|Read	|Multi-item transaction|
|Paginated Query|	Read	|Multi-item transaction|
|Execute UDF as part of the paginated query|	Read	|Multi-item transaction|



### Implementing optimistic concurrency control using ETag and HTTP headers
Every item stored in an Azure Cosmos DB container has a system defined _etag property. 
The value of the _etag is automatically generated and updated by the server every time the item is updated. 
_etag can be used with the client supplied if-match request header to allow the server to decide whether an item can be conditionally updated. 
The value of the if-match header matches the value of the _etag at the server, the item is then updated. 
If the value of the if-match request header is no longer current, the server rejects the operation with an "HTTP 412 Precondition failure" response message. 
The client then can re-fetch the item to acquire the current version of the item on the server or override the version of item in the server with its own _etag value for the item. 
In addition, _etag can be used with the if-none-match header to determine whether a refetch of a resource is needed.

The item’s _etag value changes every time the item is updated. For replace item operations, if-match must be explicitly expressed as a part of the request options. For an example, see the sample code in GitHub. _etag values are implicitly checked for all written items touched by the stored procedure. If any conflict is detected, the stored procedure will roll back the transaction and throw an exception. With this method, either all or no writes within the stored procedure are applied atomically. This is a signal to the application to reapply updates and retry the original client request.

[Database transactions and optimistic concurrency control in Azure Cosmos DB | Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency)
