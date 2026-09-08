# External notification display integration

The built-in notch window has been removed from zclaudia. Notifications remain
available in the inbox and Toast UI; session and approval behavior stays in the
application. Generic plugin panels and standalone plugin windows remain supported.

`shared/src/plugins/notification-sink.ts` reserves a transport-independent
`NotificationSinkPluginAPI` for a future connector to `macos-notch-panel` or another
display. This is a type contract only: no connector, automatic forwarding, network
listener, external process or display setting is installed by the host.

The future connector can expose the API through the existing
`PluginContext.exports` / `getPluginAPI` mechanism. A source adapter translates
business notifications into channels, items and opaque actions. It supplies a
distinct source ID per producer/backend, publishes full snapshots, and handles
returned actions through the application's existing navigation and notification
operations. The display does not interpret session IDs or execute business actions.

The connector owns transport selection, connection configuration, authentication,
reconnect handling and listener cleanup. The adapter owns initial data loading,
subscriptions, replaying a current snapshot after reconnect, and removing its
source when disconnected or deactivated. These runtime pieces are deferred to the
plugin integration phase; this contract does not add APIs to `PluginContext` that
the host cannot yet implement.

Legacy `contributes.notchTabs`, `notchTab` wire metadata and `pluginTab` notification
metadata remain readable for compatibility with existing plugins, backend versions
and stored notifications. Legacy tab registration messages are ignored by the
desktop, and no tab registry or notch UI is created. New integrations should use
the notification sink contract instead of adding more notch-specific host code.

The removed implementation remains available in Git history. The sibling
`macos-notch-panel` project is unchanged by this cleanup.
