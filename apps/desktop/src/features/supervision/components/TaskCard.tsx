import type { SupervisionTask } from '@zclaudia/shared';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import * as api from '../../../services/api';
import { useSupervisionStore } from '../store';
import { taskStatusStyle, ACTION_BUTTON } from './statusStyles';

interface TaskCardProps {
  task: SupervisionTask;
  onSelect: (task: SupervisionTask) => void;
}

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const upsertTask = useSupervisionStore(s => s.upsertTask);
  const status = taskStatusStyle(task.status);

  const handleApproveProposed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.approveSupervisionTask(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to approve task:', err);
    }
  };

  const handleRejectProposed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.rejectSupervisionTask(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to reject task:', err);
    }
  };

  const handleApproveResult = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.approveSupervisionTaskResult(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to approve result:', err);
    }
  };

  const handleRejectResult = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.rejectSupervisionTaskResult(task.id, 'Rejected by user');
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to reject result:', err);
    }
  };

  const handleResolveConflict = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.resolveSupervisionConflict(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to resolve conflict:', err);
    }
  };

  return (
    <div
      onClick={() => onSelect(task)}
      className="group px-3 py-2 bg-secondary/50 hover:bg-secondary rounded-md cursor-pointer border border-border/50 hover:border-border transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full shrink-0 ${status.badge}`}
            >
              {status.label}
            </span>
            {task.status === 'running' && (
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
            )}
            {task.priority > 0 && (
              <span className="text-[10px] text-muted-foreground">P{task.priority}</span>
            )}
          </div>
          <p className="text-sm font-medium truncate">{task.title}</p>
          {task.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {task.attempt > 1 && (
              <span className="text-[10px] text-muted-foreground">Attempt {task.attempt}</span>
            )}
            {task.dependencies.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {task.dependencies.length} deps
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Inline actions */}
      {task.status === 'proposed' && (
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={handleApproveProposed}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-md ${ACTION_BUTTON.approve}`}
          >
            <CheckCircle size={12} /> Approve
          </button>
          <button
            onClick={handleRejectProposed}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-md ${ACTION_BUTTON.reject}`}
          >
            <XCircle size={12} /> Reject
          </button>
        </div>
      )}

      {task.status === 'reviewing' && task.result?.reviewVerdict && (
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={handleApproveResult}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-md ${ACTION_BUTTON.approve}`}
          >
            <CheckCircle size={12} /> Approve Result
          </button>
          <button
            onClick={handleRejectResult}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-md ${ACTION_BUTTON.reject}`}
          >
            <XCircle size={12} /> Reject Result
          </button>
        </div>
      )}

      {task.status === 'merge_conflict' && (
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={handleResolveConflict}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-md ${ACTION_BUTTON.resolve}`}
          >
            <AlertTriangle size={12} /> Resolve Conflict
          </button>
        </div>
      )}
    </div>
  );
}
