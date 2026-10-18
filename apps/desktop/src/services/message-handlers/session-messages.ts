import type { ServerMessage } from '@zclaudia/shared/wire/messages/index';
import { useProjectStore } from '../../stores/projectStore';
import { useSystemTaskStore } from '../../stores/systemTaskStore';
import { useToastStore } from '../../stores/toastStore';

export function handleSessionMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'sessions_created': {
      const { session } = msg as any;
      const store = useProjectStore.getState();
      if (!store.sessions.find((s: any) => s.id === session.id)) {
        store.addSession(session);
      }
      return true;
    }

    case 'sessions_updated': {
      const { session } = msg as any;
      useProjectStore.getState().updateSession(session.id, session);
      // A failed generation only matters for sessions with nothing to show;
      // regen failures on already-titled sessions keep the old title silently.
      if (!session.name && !session.autoTitle && session.autoTitleError) {
        useToastStore.getState().add({
          title: "Couldn't generate a session title",
          message: `${session.autoTitleError} — will retry after the next reply.`,
          type: 'error',
          icon: 'error',
          sessionId: session.id,
        });
      }
      return true;
    }

    case 'system_task_update': {
      const { task } = msg as any;
      useSystemTaskStore.getState().updateTask(task);
      return true;
    }

    default:
      return false;
  }
}
