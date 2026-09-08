# External assistant chat integration

The built-in desktop floating ball and standalone Claudia Chat window have been
removed. Their routes, window styles, Tauri commands, cross-window events, global
shortcut registration and shortcut settings are retired. The window manager no
longer lists these as built-in window types. The tray's **Show Main Window** action
still opens the main application; ordinary in-app keyboard shortcuts are unchanged.

Mobile Claudia Chat, its sidebar entry and badges, task cards, inline responses,
permission handling and backend conversation APIs remain in zclaudia. The Agent
enable toggle and model settings still configure that backend functionality.
`useAgentInitialization` retains configuration loading and host project initialization
without creating any desktop windows. Existing `claudia-shortcut-config` browser
storage is no longer read or applied.

`shared/src/plugins/assistant-chat.ts` reserves `AssistantChatPluginAPI` for a future
connector to zpet or another assistant UI. This is a type contract only. A future
backend adapter can publish it via `PluginContext.exports` and be discovered via
`getPluginAPI`; cross-process access still requires an explicit transport adapter.
No connection, external process or automatic forwarding is installed in this phase.

The adapter owns backend/project/session routing, translating streamed replies and
task updates, cancellation, and navigation back to the main application. A completed
response stream does not imply a submitted task has finished; task status is separate.
The display owns pet animation, chat windows and desktop shortcuts. It must not import
the application's Zustand stores, connection providers or Tauri window helpers.

During integration, define authentication, request deduplication, stream cancellation,
reconnect replay and task subscription reconciliation. Disposing a UI subscription
must not implicitly cancel backend work. Initial approval handling should navigate
back to zclaudia; this contract does not grant a display authority to approve tools.
The existing NotificationSinkPluginAPI remains a separate display-only contract.

The zpet repository is unchanged. Its upgrade and connector implementation belong
to the following phases. Removed UI code remains available in Git history.
