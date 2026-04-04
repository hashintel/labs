export {
  type ChangeEvent,
  type ChangeOp,
  type ColumnInfo,
  type Connector,
  type ForeignKey,
  type PullResult,
  type TableConfig,
  extractKey,
  pkColumns,
} from "./types.js";

export { createPostgresConnector, type PostgresConnectorConfig, type PostgresTableConfig } from "./postgres.js";
export { createPostgresCdcConnector, type PostgresCdcConfig } from "./postgres-cdc.js";
export { createConnector, type ConnectorDef } from "./create.js";
