import type Database from 'better-sqlite3';

import {
  CommandTaskExecutor,
  commandTaskLogPath,
  pidAlive,
} from '../../domains/tasks/executors/command-executor.js';
import { TaskRepository } from '../../domains/tasks/repository.js';
import { TaskService } from '../../domains/tasks/task-service.js';
import type { TaskPort } from '../../utils/task-port.js';

const adapters = new WeakMap<Database.Database, TaskPort>();

/** Adapts the task domain and its command executor to the application port. */
export function createTaskAdapter(db: Database.Database): TaskPort {
  const cached = adapters.get(db);
  if (cached) return cached;
  const repository = new TaskRepository(db);
  const service = new TaskService(repository);
  const commandExecutor = new CommandTaskExecutor(repository);
  const adapter: TaskPort = {
    createTask: input => service.createTask(input),
    findById: id => repository.findById(id),
    update: (id, input) => repository.update(id, input),
    listByTypeAndStatuses: (type, statuses, sessionId) =>
      repository.listByTypeAndStatuses(type, statuses, sessionId),
    listEvents: id => repository.listEvents(id),
    findLatestAgentTaskForSession: id => repository.findLatestAgentTaskForSession(id),
    startTask: (id, input) => service.startTask(id, input),
    completeTask: (id, result) => service.completeTask(id, result),
    failTask: (id, result) => service.failTask(id, result),
    stopTask: (id, result) => service.stopTask(id, result),
    commandTasks: {
      start: task => commandExecutor.start(task),
      adopt: (task, child, output, outputPath) =>
        commandExecutor.adopt(task, child, output, outputPath),
      stop: (id, reason) => commandExecutor.stop(id, reason),
      reconcile: () => commandExecutor.reconcile(),
      logPath: commandTaskLogPath,
      pidAlive,
    },
  };
  adapters.set(db, adapter);
  return adapter;
}
