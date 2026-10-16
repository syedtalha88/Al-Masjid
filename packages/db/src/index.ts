// MongoDB clients, schema, policy layer, scoped repositories, migrations (PHASE_01).
export {
  clientOptions,
  createDbHandle,
  type DbConfig,
  type DbHandle,
  type DbProcess,
  type TxContext,
  withTransaction,
} from './client.ts';
export * from './collections.ts';
export * from './roles.ts';
export { ATLAS_ACTION, type AtlasCustomRole, atlasRole, atlasRolesFile } from './roles-atlas.ts';
export {
  applyLocalRoles,
  dropLocalRoles,
  type LocalDbUser,
  mongoPrivileges,
  resetLocalDatabase,
} from './roles-local.ts';
export * from './scope.ts';
export * from './values.ts';
export { type RoleCheck, URI_VARIABLE, userFromEnv, verifyRoles } from './verify-roles.ts';
