import { parseWorkflowDefinition, type WorkflowLoader } from '../shared/invokedWorkflows';

export const loadInvokedWorkflow: WorkflowLoader = async (requested, caller) => {
  const read = (window as any).electronAPI?.readInvokedWorkflow;
  if (!read) throw Error('Reading workflow dependencies requires the Studio desktop app.');
  const result = await read(requested, caller);
  return { path: result.path, definition: parseWorkflowDefinition(result.content) };
};
