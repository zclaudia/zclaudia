/**
 * WorkspaceService — agent workspace management.
 *
 * Loads and manages the agent's configuration files (SOUL.md, AGENTS.md,
 * TOOLS.md, Skills) and assembles a shared system prompt so every provider
 * runs with the same persona configuration.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { systemTaskRegistry } from './system-task-registry.js';

const WORKSPACE_DIR = process.env.ZCLAUDIA_DATA_DIR
  ? path.resolve(process.env.ZCLAUDIA_DATA_DIR, 'workspace')
  : path.join(os.homedir(), '.zclaudia', 'workspace');
const CACHE_TTL = 60000; // 1 minute
const MAX_FILE_SIZE = 100 * 1024; // 100KB cap

export interface WorkspaceOptions {
  projectId?: string;
  projectPath?: string;
  skills?: string[];
}

export interface PromptSection {
  title: string;
  content: string;
  priority: number;
  source: string;
}

export interface WorkspaceConfig {
  soul: string | null;
  agents: string | null;
  tools: string | null;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
}

/**
 * WorkspaceService — agent workspace configuration.
 */
export class WorkspaceService {
  private cache: Map<string, { content: string; mtime: number }> = new Map();
  private initialized = false;

  /**
   * Load a single prompt file (with caching and a size cap).
   */
  private async loadFile(basePath: string, filename: string): Promise<string | null> {
    const filePath = path.join(basePath, filename);

    try {
      const stat = await fs.stat(filePath);

      // Enforce the size cap.
      if (stat.size > MAX_FILE_SIZE) {
        console.warn(`[Workspace] File too large: ${filePath} (${stat.size} bytes)`);
        return null;
      }

      // Serve from cache when the file has not changed.
      const cached = this.cache.get(filePath);
      if (cached && cached.mtime >= stat.mtime.getTime()) {
        return cached.content;
      }

      // Read and cache.
      const content = await fs.readFile(filePath, 'utf-8');
      this.cache.set(filePath, {
        content,
        mtime: stat.mtime.getTime(),
      });

      return content;
    } catch (error) {
      // Missing file or read error — treated as absent.
      return null;
    }
  }

  /**
   * Assemble the full workspace system prompt, sections ordered by priority.
   */
  async assembleSystemPrompt(options: WorkspaceOptions = {}): Promise<string> {
    const { projectId, projectPath, skills = [] } = options;
    const sections: PromptSection[] = [];

    // 1. Global SOUL.md (persona) — highest priority.
    const soul = await this.loadFile(WORKSPACE_DIR, 'SOUL.md');
    if (soul) {
      sections.push({
        title: '## Your Identity',
        content: soul.trim(),
        priority: 100,
        source: 'workspace:SOUL.md',
      });
    }

    // 2. Global AGENTS.md (behavior guidelines).
    const agents = await this.loadFile(WORKSPACE_DIR, 'AGENTS.md');
    if (agents) {
      sections.push({
        title: '## Behavior Guidelines',
        content: agents.trim(),
        priority: 90,
        source: 'workspace:AGENTS.md',
      });
    }

    // 3. Project-level configuration (overrides global AGENTS.md).
    if (projectId) {
      const projectDir = path.join(WORKSPACE_DIR, 'projects', projectId);
      const projectAgents = await this.loadFile(projectDir, 'AGENTS.md');
      if (projectAgents) {
        sections.push({
          title: '## Project-Specific Guidelines',
          content: projectAgents.trim(),
          priority: 95,
          source: `workspace:projects/${projectId}/AGENTS.md`,
        });
      }
    }

    // 4. Global TOOLS.md (tool guide).
    const tools = await this.loadFile(WORKSPACE_DIR, 'TOOLS.md');
    if (tools) {
      sections.push({
        title: '## Tool Usage Guide',
        content: tools.trim(),
        priority: 80,
        source: 'workspace:TOOLS.md',
      });
    }

    // 5. Project-root CLAUDE.md (project context, Claude Code style).
    if (projectPath) {
      const claudeMd = await this.loadFile(projectPath, 'CLAUDE.md');
      if (claudeMd) {
        sections.push({
          title: '## Project Context',
          content: claudeMd.trim(),
          priority: 70,
          source: 'project:CLAUDE.md',
        });
      }
    }

    // 6. Enabled skills.
    for (const skillId of skills) {
      const skillContent = await this.loadSkill(skillId);
      if (skillContent) {
        sections.push({
          title: `## Skill: ${skillId}`,
          content: skillContent.trim(),
          priority: 50,
          source: `workspace:skills/${skillId}/SKILL.md`,
        });
      }
    }

    // Highest priority first, then assemble.
    sections.sort((a, b) => b.priority - a.priority);

    if (sections.length === 0) {
      return '';
    }

    return sections.map(s => `${s.title}\n\n${s.content}`).join('\n\n---\n\n');
  }

  /**
   * Load a single skill's content.
   */
  async loadSkill(skillId: string): Promise<string | null> {
    // Path-traversal guard.
    const normalizedId = path.basename(skillId);
    if (normalizedId !== skillId || skillId.includes('..')) {
      console.warn(`[Workspace] Invalid skill ID: ${skillId}`);
      return null;
    }

    const skillPath = path.join(WORKSPACE_DIR, 'skills', normalizedId);
    return this.loadFile(skillPath, 'SKILL.md');
  }

  /**
   * List all available skills.
   */
  async listSkills(): Promise<SkillInfo[]> {
    const skillsDir = path.join(WORKSPACE_DIR, 'skills');

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      const skills: SkillInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillId = entry.name;
        const skillPath = path.join(skillsDir, skillId, 'SKILL.md');

        try {
          const content = await this.loadFile(path.join(skillsDir, skillId), 'SKILL.md');
          if (content) {
            // name from the first heading line, description from the first quote line.
            const lines = content.split('\n').filter(l => l.trim());
            const name = lines[0]?.replace(/^#\s*/, '') || skillId;
            const description = lines[1]?.replace(/^>\s*/, '') || '';

            skills.push({
              id: skillId,
              name,
              description,
              path: skillPath,
            });
          }
        } catch {
          // Ignore invalid skills.
        }
      }

      return skills;
    } catch {
      return [];
    }
  }

  /**
   * Read the current workspace configuration.
   */
  async getConfig(): Promise<WorkspaceConfig> {
    const [soul, agents, tools] = await Promise.all([
      this.loadFile(WORKSPACE_DIR, 'SOUL.md'),
      this.loadFile(WORKSPACE_DIR, 'AGENTS.md'),
      this.loadFile(WORKSPACE_DIR, 'TOOLS.md'),
    ]);

    return { soul, agents, tools };
  }

  /**
   * Update workspace configuration files.
   */
  async updateConfig(config: Partial<WorkspaceConfig>): Promise<void> {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });

    const updates: Promise<void>[] = [];

    if (config.soul !== undefined && config.soul !== null) {
      const filePath = path.join(WORKSPACE_DIR, 'SOUL.md');
      updates.push(fs.writeFile(filePath, config.soul, 'utf-8'));
      this.cache.delete(filePath);
    }

    if (config.agents !== undefined && config.agents !== null) {
      const filePath = path.join(WORKSPACE_DIR, 'AGENTS.md');
      updates.push(fs.writeFile(filePath, config.agents, 'utf-8'));
      this.cache.delete(filePath);
    }

    if (config.tools !== undefined && config.tools !== null) {
      const filePath = path.join(WORKSPACE_DIR, 'TOOLS.md');
      updates.push(fs.writeFile(filePath, config.tools, 'utf-8'));
      this.cache.delete(filePath);
    }

    await Promise.all(updates);
  }

  /**
   * Clear the file cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Initialize the workspace directory and default files.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const dirs = [
      WORKSPACE_DIR,
      path.join(WORKSPACE_DIR, 'skills'),
      path.join(WORKSPACE_DIR, 'projects'),
    ];

    // Create the directory layout.
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {
        // Already exists.
      }
    }

    // Create default configuration files when absent.
    const defaults: Record<string, string> = {
      'SOUL.md': this.getDefaultSoul(),
      'AGENTS.md': this.getDefaultAgents(),
      'TOOLS.md': this.getDefaultTools(),
    };

    for (const [filename, content] of Object.entries(defaults)) {
      const filePath = path.join(WORKSPACE_DIR, filename);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[Workspace] Created default ${filename}`);
      }
    }

    this.initialized = true;
    console.log(`[Workspace] Initialized at ${WORKSPACE_DIR}`);
  }

  /**
   * Workspace directory path.
   */
  getWorkspaceDir(): string {
    return WORKSPACE_DIR;
  }

  private getDefaultSoul(): string {
    return `# Claudia's Soul

## Who I Am
I am Claudia, a professional coding assistant focused on helping users build software.

## Personality
- Concise and efficient — no rambling
- Rigorous and professional, with care for code quality
- Friendly and patient, easy to communicate with

## Values
- Code quality first
- User privacy above all
- Always security-conscious
- Keep learning and improving

## How I Communicate
- Let the code speak
- Offer concrete suggestions instead of vague statements
- Surface potential problems proactively
`;
  }

  private getDefaultAgents(): string {
    return `# Agent Behavior Guidelines

## Response Style
- Reply in the user's language
- Code first, explanation after
- One thing at a time
- Concise and clear; avoid redundancy

## Workflow
1. Understand the user's intent
2. Draft an execution plan
3. Execute step by step and report back
4. Confirm completion

## Safety Constraints
- Never run destructive commands such as rm -rf
- Confirm before modifying files
- Ask the user before sensitive operations
- Never leak secrets or sensitive data

## Code Conventions
- Follow the project's existing code style
- Add comments where they help
- Keep code readable
`;
  }

  private getDefaultTools(): string {
    return `# Tool Usage Guide

## File Operations
- Reading files: use the Read tool
- Editing files: prefer Edit over rewriting whole files
- Creating files: confirm the directory exists, then Write

## Code Search
- Exact search: Grep
- File lookup: Glob
- Broad exploration: Agent subprocesses

## Command Execution
- Prefer dedicated tools over Bash
- Mind timeouts (2 minutes by default)
- Use run_in_background for long-running tasks

## Git Operations
- Prefer dedicated Git tools
- Review changes before committing
- Follow commit message conventions
`;
  }
}

// Singleton export
export const workspaceService = new WorkspaceService();

// Initialized on server startup.
export async function initWorkspace(): Promise<void> {
  await workspaceService.initialize();
}

// System task: periodic cache cleanup.
systemTaskRegistry.register({
  id: 'system:workspace_cache_cleanup',
  name: 'Workspace Cache Cleanup',
  description: 'Periodically clears workspace file cache',
  category: 'maintenance',
  intervalMs: 5 * 60 * 1000, // 5 minutes
});

setInterval(
  () => {
    systemTaskRegistry.markRunStart('system:workspace_cache_cleanup');
    const start = Date.now();
    try {
      workspaceService.clearCache();
      systemTaskRegistry.markRunComplete('system:workspace_cache_cleanup', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete(
        'system:workspace_cache_cleanup',
        Date.now() - start,
        String(err)
      );
    }
  },
  5 * 60 * 1000
).unref();
