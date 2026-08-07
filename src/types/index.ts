export type PropertyType = 'string' | 'number' | 'boolean' | 'expression' | 'variable' | 'select';

export interface PropertyDefinition {
  name: string;
  label: string;
  type: PropertyType;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  required?: boolean;
  description?: string;
}

export type NodeKind = 'activity' | 'sequence' | 'decision' | 'loop' | 'start' | 'end';

export interface ActivityDefinition {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  color: string;
  properties: PropertyDefinition[];
  nodeType: NodeKind;
  isContainer?: boolean; // container activities wrap child activities in a Do-section
}

export interface ActivityCategory {
  id: string;
  name: string;
  icon: string;
  activities: ActivityDefinition[];
}

export interface WorkflowNodeData {
  activityId: string;
  label: string;
  icon: string;
  color: string;
  properties: Record<string, unknown>;
  childIds?: string[];   // ordered child node IDs (for container activities)
  parentId?: string;     // set on child nodes so the canvas can exclude them from the top level
  isContainer?: boolean; // mirrors ActivityDefinition.isContainer for quick access
  breakpoint?: boolean;  // pauses debug execution before this activity runs
}

export interface WorkflowVariable {
  id: string;
  name: string;
  type: string;
  defaultValue: string;
  scope: string;
}

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'error' | 'completed';
