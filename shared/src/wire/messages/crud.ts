/**
 * CRUD messages for projects, sessions, servers, and llm profiles.
 * Includes Get/Add/Update/Delete requests, List/OperationResult responses,
 * Created/Updated/Deleted broadcast messages, and session messages / runtime commands.
 */

import type { BackendServer } from '../../core/server.js';
import type { LlmProfileConfig } from '../../core/llm-profile.js';
import type { Session } from '../../core/session.js';
import type { Message } from '../../core/message.js';
import type { Project } from '../../core/project.js';
import type { SlashCommand } from '../../features/commands.js';

// ---- Projects ----

export interface GetProjectsMessage {
  type: 'get_projects';
}

export interface AddProjectMessage {
  type: 'add_project';
  project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface UpdateProjectMessage {
  type: 'update_project';
  id: string;
  project: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface DeleteProjectMessage {
  type: 'delete_project';
  id: string;
}

export interface ProjectsListMessage {
  type: 'projects_list';
  projects: Project[];
}

export interface ProjectOperationResultMessage {
  type: 'project_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  project?: Project;
  error?: string;
}

export interface ProjectsCreatedMessage {
  type: 'projects_created';
  project: Project;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  project: Project;
}

export interface ProjectsDeletedMessage {
  type: 'projects_deleted';
  success: boolean;
  id: string;
}

// ---- Sessions ----

export interface GetSessionsMessage {
  type: 'get_sessions';
}

export interface AddSessionMessage {
  type: 'add_session';
  session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface UpdateSessionMessage {
  type: 'update_session';
  id: string;
  session: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface DeleteSessionMessage {
  type: 'delete_session';
  id: string;
}

export interface SessionsListMessage {
  type: 'sessions_list';
  sessions: Session[];
}

export interface SessionOperationResultMessage {
  type: 'session_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  session?: Session;
  error?: string;
}

export interface SessionsCreatedMessage {
  type: 'sessions_created';
  session: Session;
}

export interface SessionsUpdatedMessage {
  type: 'sessions_updated';
  session: Session;
}

export interface SessionsDeletedMessage {
  type: 'sessions_deleted';
  success: boolean;
  id: string;
}

export interface GetSessionMessagesMessage {
  type: 'get_session_messages';
  sessionId: string;
  limit?: number;
  before?: number; // timestamp
}

export interface SessionMessagesMessage {
  type: 'session_messages';
  sessionId: string;
  messages: Message[];
  hasMore: boolean;
}

// ---- Servers ----

export interface GetServersMessage {
  type: 'get_servers';
}

export interface AddServerMessage {
  type: 'add_server';
  server: Omit<BackendServer, 'id' | 'createdAt' | 'lastConnected'>;
}

export interface UpdateServerMessage {
  type: 'update_server';
  id: string;
  server: Partial<Omit<BackendServer, 'id' | 'createdAt'>>;
}

export interface DeleteServerMessage {
  type: 'delete_server';
  id: string;
}

export interface ServersListMessage {
  type: 'servers_list';
  servers: BackendServer[];
}

export interface ServerOperationResultMessage {
  type: 'server_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  serverId?: string;
  error?: string;
}

export interface ServersCreatedMessage {
  type: 'servers_created';
  server: BackendServer;
}

export interface ServersUpdatedMessage {
  type: 'servers_updated';
  server: BackendServer;
}

export interface ServersDeletedMessage {
  type: 'servers_deleted';
  success: boolean;
  id: string;
}

// ---- Llm Profiles ----

export interface GetLlmProfilesMessage {
  type: 'get_llm_profiles';
}

export interface AddLlmProfileMessage {
  type: 'add_llm_profile';
  llmProfile: Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface UpdateLlmProfileMessage {
  type: 'update_llm_profile';
  id: string;
  llmProfile: Partial<Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface DeleteLlmProfileMessage {
  type: 'delete_llm_profile';
  id: string;
}

export interface LlmProfilesListMessage {
  type: 'llm_profiles_list';
  llmProfiles: LlmProfileConfig[];
}

export interface LlmProfileOperationResultMessage {
  type: 'llm_profile_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  llmProfile?: LlmProfileConfig;
  error?: string;
}

export interface LlmProfilesCreatedMessage {
  type: 'llm_profiles_created';
  llmProfile: LlmProfileConfig;
}

export interface LlmProfilesUpdatedMessage {
  type: 'llm_profiles_updated';
  llmProfile: LlmProfileConfig;
}

export interface LlmProfilesDeletedMessage {
  type: 'llm_profiles_deleted';
  success: boolean;
  id: string;
}

// ---- Runtime Commands ----

export interface GetProviderCommandsMessage {
  type: 'get_provider_commands';
  llmProfileId: string;
  projectRoot?: string;
}

export interface ProviderCommandsMessage {
  type: 'provider_commands';
  llmProfileId: string;
  commands: SlashCommand[];
}

export type CrudClientMessage =
  | GetProjectsMessage
  | GetSessionsMessage
  | GetServersMessage
  | AddServerMessage
  | UpdateServerMessage
  | DeleteServerMessage
  | AddSessionMessage
  | UpdateSessionMessage
  | DeleteSessionMessage
  | AddProjectMessage
  | UpdateProjectMessage
  | DeleteProjectMessage
  | GetLlmProfilesMessage
  | AddLlmProfileMessage
  | UpdateLlmProfileMessage
  | DeleteLlmProfileMessage
  | GetSessionMessagesMessage
  | GetProviderCommandsMessage;

export type CrudServerMessage =
  | ProjectsListMessage
  | SessionsListMessage
  | ServersListMessage
  | ServerOperationResultMessage
  | SessionOperationResultMessage
  | ProjectOperationResultMessage
  | LlmProfilesListMessage
  | LlmProfileOperationResultMessage
  | SessionMessagesMessage
  | ProviderCommandsMessage
  | ServersCreatedMessage
  | ServersUpdatedMessage
  | ServersDeletedMessage
  | SessionsCreatedMessage
  | SessionsUpdatedMessage
  | SessionsDeletedMessage
  | ProjectsCreatedMessage
  | ProjectsUpdatedMessage
  | ProjectsDeletedMessage
  | LlmProfilesCreatedMessage
  | LlmProfilesUpdatedMessage
  | LlmProfilesDeletedMessage;
