// MongoDB clients, schema, policy layer, scoped repositories, migrations (PHASE_01).
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
