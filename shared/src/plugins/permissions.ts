export type Permission =
  // Elevated-risk level
  | 'session.read'
  | 'project.read'
  | 'storage'
  // Medium-risk level
  | 'fs.read'
  | 'network.fetch'
  | 'timer'
  | 'provider.call'
  // Sensitive level
  | 'fs.write'
  | 'session.write'
  | 'notification'
  | 'clipboard.read'
  | 'clipboard.write'
  // Dangerous level
  | 'shell.execute'
  | 'provider.register';
