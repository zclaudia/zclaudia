import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWorkflowRepo = {
  findByProject: vi.fn().mockReturnValue([]),
  findById: vi.fn(),
  findBySystemKey: vi.fn(),
  findGlobalByTemplate: vi.fn().mockReturnValue({ id: 'existing' }),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findByProjectAndTemplate: vi.fn(),
  findAllActive: vi.fn().mockReturnValue([]),
};
const mockRunRepo = {
  findByWorkflow: vi.fn().mockReturnValue([]),
  findById: vi.fn(),
};
const mockStepRunRepo = {
  findByRun: vi.fn().mockReturnValue([]),
};
const mockEngine = {
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  approveStep: vi.fn(),
  rejectStep: vi.fn(),
  isRunning: vi.fn().mockReturnValue(false),
};

vi.mock('../repository.js', () => ({
  WorkflowRepository: class { constructor() { Object.assign(this, mockWorkflowRepo); } },
}));
vi.mock('../workflow-run-repository.js', () => ({
  WorkflowRunRepository: class { constructor() { Object.assign(this, mockRunRepo); } },
}));
vi.mock('../workflow-step-run-repository.js', () => ({
  WorkflowStepRunRepository: class { constructor() { Object.assign(this, mockStepRunRepo); } },
}));
vi.mock('../engine.js', () => ({}));
vi.mock('../templates.js', () => ({
  PERMISSION_WORKFLOW_TEMPLATE_ID: 'permission-escalation-default',
  SYSTEM_PERMISSION_ESCALATION_FALLBACK_KEY: 'permission_escalation_fallback',
  BUILTIN_WORKFLOW_TEMPLATES: [
    { id: 'permission-escalation-default', name: 'Template 1', description: 'desc', definition: { triggers: [], nodes: [], edges: [], entryNodeId: '' } },
    { id: 'tpl1', name: 'Template 1', description: 'desc', definition: { triggers: [], nodes: [], edges: [], entryNodeId: '' } },
  ],
}));

import { ImmutableSystemWorkflowError, WorkflowService } from '../service.js';

describe('WorkflowService', () => {
  let service: WorkflowService;
  let mockBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set defaults after clearAllMocks
    mockWorkflowRepo.findByProject.mockReturnValue([]);
    mockWorkflowRepo.findById.mockReturnValue(undefined);
    mockWorkflowRepo.findBySystemKey.mockReturnValue(null);
    mockWorkflowRepo.findAllActive.mockReturnValue([]);
    mockRunRepo.findByWorkflow.mockReturnValue([]);
    mockStepRunRepo.findByRun.mockReturnValue([]);
    mockEngine.isRunning.mockReturnValue(false);

    mockBroadcast = vi.fn();
    service = new WorkflowService({} as any, mockBroadcast, mockEngine as any);
  });

  describe('listWorkflows', () => {
    it('delegates to workflowRepo.findByProject', () => {
      const result = service.listWorkflows('p1');
      expect(result).toEqual([]);
      expect(mockWorkflowRepo.findByProject).toHaveBeenCalledWith('p1');
    });
  });

  describe('getWorkflow', () => {
    it('returns null when not found', () => {
      mockWorkflowRepo.findById.mockReturnValue(undefined);
      expect(service.getWorkflow('w1')).toBeUndefined();
    });

    it('returns workflow when found', () => {
      const wf = { id: 'w1', name: 'flow' };
      mockWorkflowRepo.findById.mockReturnValue(wf);
      expect(service.getWorkflow('w1')).toEqual(wf);
    });
  });

  describe('createWorkflow', () => {
    it('creates workflow and broadcasts update', () => {
      const mockWorkflow = { id: 'w1', projectId: 'p1', status: 'active', definition: { triggers: [] } };
      mockWorkflowRepo.create.mockReturnValue(mockWorkflow);

      const result = service.createWorkflow({
        projectId: 'p1', name: 'flow', definition: { triggers: [], nodes: [], edges: [], entryNodeId: '' } as any,
      });

      expect(result).toEqual(mockWorkflow);
      expect(mockBroadcast).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'workflow_update' }));
    });

    it('creates and broadcasts a disabled workflow without scheduling side effects', () => {
      const mockWorkflow = { id: 'w1', projectId: 'p1', status: 'disabled', definition: { triggers: [] } };
      mockWorkflowRepo.create.mockReturnValue(mockWorkflow);

      const result = service.createWorkflow({
        projectId: 'p1', name: 'flow', definition: { triggers: [], nodes: [], edges: [], entryNodeId: '' } as any, status: 'disabled',
      });

      expect(result).toEqual(mockWorkflow);
      expect(mockBroadcast).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'workflow_update' }));
    });
  });

  describe('updateWorkflow', () => {
    it('updates and broadcasts', () => {
      const updated = { id: 'w1', projectId: 'p1', status: 'active', definition: { triggers: [] } };
      mockWorkflowRepo.update.mockReturnValue(updated);

      const result = service.updateWorkflow('w1', { name: 'new name' });
      expect(result).toEqual(updated);
      expect(mockBroadcast).toHaveBeenCalled();
    });

    it('rejects updates to system workflows', () => {
      mockWorkflowRepo.findById.mockReturnValue({ id: 'sys-1', isSystem: true });
      expect(() => service.updateWorkflow('sys-1', { name: 'new name' })).toThrow(ImmutableSystemWorkflowError);
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes and broadcasts when successful', () => {
      mockWorkflowRepo.delete.mockReturnValue(true);
      const result = service.deleteWorkflow('w1', 'p1');
      expect(result).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'workflow_deleted' }));
    });

    it('returns false when not found', () => {
      mockWorkflowRepo.delete.mockReturnValue(false);
      expect(service.deleteWorkflow('w1', 'p1')).toBe(false);
    });

    it('rejects deletes of system workflows', () => {
      mockWorkflowRepo.findById.mockReturnValue({ id: 'sys-1', isSystem: true });
      expect(() => service.deleteWorkflow('sys-1', 'p1')).toThrow(ImmutableSystemWorkflowError);
    });
  });

  describe('getTemplates', () => {
    it('returns builtin templates', () => {
      const templates = service.getTemplates();
      expect(templates.map((t) => t.id)).toEqual(['permission-escalation-default', 'tpl1']);
    });
  });

  describe('createFromTemplate', () => {
    it('throws when template not found', () => {
      expect(() => service.createFromTemplate('p1', 'nonexistent')).toThrow('Template not found');
    });

    it('rejects permission escalation template instantiation', () => {
      expect(() => service.createFromTemplate('p1', 'permission-escalation-default')).toThrow(ImmutableSystemWorkflowError);
    });

    it('toggles existing workflow from active to disabled', () => {
      const existing = { id: 'w1', status: 'active', projectId: 'p1', definition: { triggers: [] } };
      mockWorkflowRepo.findByProjectAndTemplate.mockReturnValue(existing);
      mockWorkflowRepo.findById.mockReturnValue(undefined);
      mockWorkflowRepo.update.mockReturnValue({ ...existing, status: 'disabled' });

      service.createFromTemplate('p1', 'tpl1');
      expect(mockWorkflowRepo.update).toHaveBeenCalledWith('w1', expect.objectContaining({ status: 'disabled' }));
    });

    it('toggles existing workflow from disabled to active', () => {
      const existing = { id: 'w1', status: 'disabled', projectId: 'p1', definition: { triggers: [] } };
      mockWorkflowRepo.findByProjectAndTemplate.mockReturnValue(existing);
      mockWorkflowRepo.findById.mockReturnValue(undefined);
      mockWorkflowRepo.update.mockReturnValue({ ...existing, status: 'active' });

      service.createFromTemplate('p1', 'tpl1');
      expect(mockWorkflowRepo.update).toHaveBeenCalledWith('w1', expect.objectContaining({ status: 'active' }));
    });

    it('creates new workflow from template when not existing', () => {
      mockWorkflowRepo.findByProjectAndTemplate.mockReturnValue(null);
      const created = { id: 'w2', projectId: 'p1', status: 'active', definition: { triggers: [] } };
      mockWorkflowRepo.create.mockReturnValue(created);

      service.createFromTemplate('p1', 'tpl1');
      expect(mockWorkflowRepo.create).toHaveBeenCalled();
    });
  });

  describe('triggerWorkflow', () => {
    it('throws when workflow not found', async () => {
      mockWorkflowRepo.findById.mockReturnValue(null);
      await expect(service.triggerWorkflow('w1')).rejects.toThrow('Workflow not found');
    });

    it('throws when workflow not active', async () => {
      mockWorkflowRepo.findById.mockReturnValue({ id: 'w1', status: 'disabled' });
      await expect(service.triggerWorkflow('w1')).rejects.toThrow('not active');
    });

    it('delegates to engine.startRun with the options object', async () => {
      const wf = { id: 'w1', projectId: 'p1', status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } };
      mockWorkflowRepo.findById.mockReturnValue(wf);
      mockEngine.startRun.mockResolvedValue({ id: 'r1' });

      await service.triggerWorkflow('w1', 'manual', 'detail');
      expect(mockEngine.startRun).toHaveBeenCalledWith(expect.objectContaining({
        workflowId: 'w1',
        projectId: 'p1',
        definition: wf.definition,
        triggerSource: 'manual',
        initiator: 'manual',
        actionKind: 'workflow',
        actionRef: 'w1',
        triggerDetail: 'detail',
        trackingKey: 'w1',
      }));
    });

    it('uses the supplied initiator when provided', async () => {
      const wf = { id: 'w1', projectId: 'p1', status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } };
      mockWorkflowRepo.findById.mockReturnValue(wf);
      mockEngine.startRun.mockResolvedValue({ id: 'r1' });

      await service.triggerWorkflow('w1', 'event', 'detail', undefined, 'automation:abc');
      expect(mockEngine.startRun).toHaveBeenCalledWith(expect.objectContaining({ initiator: 'automation:abc' }));
    });
  });

  describe('getRuns', () => {
    it('delegates to runRepo', () => {
      service.getRuns('w1', 10);
      expect(mockRunRepo.findByWorkflow).toHaveBeenCalledWith('w1', 10);
    });
  });

  describe('getRun', () => {
    it('returns null when run not found', () => {
      mockRunRepo.findById.mockReturnValue(null);
      expect(service.getRun('r1')).toBeNull();
    });

    it('returns run with step runs', () => {
      const run = { id: 'r1' };
      const steps = [{ id: 'sr1' }];
      mockRunRepo.findById.mockReturnValue(run);
      mockStepRunRepo.findByRun.mockReturnValue(steps);

      const result = service.getRun('r1');
      expect(result).toEqual({ run, stepRuns: steps });
    });
  });

  describe('cancelRun', () => {
    it('delegates to engine', () => {
      service.cancelRun('r1');
      expect(mockEngine.cancelRun).toHaveBeenCalledWith('r1');
    });
  });

  describe('scheduling/event-bridge removal', () => {
    it('no longer exposes scheduling or event-bridge methods', () => {
      expect((service as any).tick).toBeUndefined();
      expect((service as any).syncSchedule).toBeUndefined();
      expect((service as any).rebuildEventSubscriptions).toBeUndefined();
      expect((service as any).computeNextRun).toBeUndefined();
      expect((service as any).matchesFilter).toBeUndefined();
    });
  });

  describe('approveStep', () => {
    it('delegates to engine', () => {
      mockEngine.approveStep.mockReturnValue(true);
      expect(service.approveStep('sr1')).toBe(true);
      expect(mockEngine.approveStep).toHaveBeenCalledWith('sr1');
    });
  });

  describe('rejectStep', () => {
    it('delegates to engine', () => {
      mockEngine.rejectStep.mockReturnValue(true);
      expect(service.rejectStep('sr1')).toBe(true);
      expect(mockEngine.rejectStep).toHaveBeenCalledWith('sr1');
    });
  });

  describe('initialize', () => {
    it('creates system fallback when missing', () => {
      mockWorkflowRepo.findBySystemKey.mockReturnValue(null);
      mockWorkflowRepo.findGlobalByTemplate.mockReturnValue(null);

      service.initialize();

      expect(mockWorkflowRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        templateId: 'permission-escalation-default',
        isSystem: true,
        systemKey: 'permission_escalation_fallback',
        status: 'active',
      }));
    });

    it('adopts legacy global fallback when system fallback is missing', () => {
      mockWorkflowRepo.findBySystemKey.mockReturnValue(null);
      mockWorkflowRepo.findGlobalByTemplate.mockReturnValue({ id: 'legacy-1', status: 'disabled' });

      service.initialize();

      expect(mockWorkflowRepo.update).toHaveBeenCalledWith('legacy-1', expect.objectContaining({
        status: 'active',
        isSystem: true,
        systemKey: 'permission_escalation_fallback',
      }));
    });

    it('repairs disabled system fallback', () => {
      mockWorkflowRepo.findBySystemKey.mockReturnValue({
        id: 'sys-1',
        status: 'disabled',
        templateId: 'permission-escalation-default',
        isSystem: true,
        definition: { broken: true },
      });

      service.initialize();

      expect(mockWorkflowRepo.update).toHaveBeenCalledWith('sys-1', expect.objectContaining({
        status: 'active',
        isSystem: true,
        systemKey: 'permission_escalation_fallback',
      }));
    });
  });
});
