export {
  ConfigLoadError,
  type LoadConfigResult,
  loadProjectConfig,
} from "./load.js";
export {
  CONFIG_REL,
  LOCAL_REL,
  configPath,
  localPath,
  sidebarDir,
} from "./paths.js";
export type { SidebarConfigFile, SidebarLocalFile } from "./schema.js";
export {
  type GitignoreAction,
  type GitignoreConsent,
  type PersistConfigResult,
  type PersistLocalResult,
  persistConfig,
  persistLocal,
} from "./write.js";
export {
  type GitignoreState,
  appendLocalToGitignore,
  gitignoreState,
  isLocalIgnored,
} from "./gitignore.js";
