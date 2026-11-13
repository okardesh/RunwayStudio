import { useWorkflowStore } from '../store/workflowStore';
import { useUiTargetStore } from '../store/uiTargetStore';
import { useWorkflowAnalyzerStore } from '../store/workflowAnalyzerStore';
import { useUiStore } from '../store/uiStore';

export function analyzeCurrentWorkflow() {
  const workflow = useWorkflowStore.getState();
  const report = useWorkflowAnalyzerStore.getState().analyze({ ...workflow, targets: useUiTargetStore.getState().targets });
  useUiStore.setState({ activeBottomPanelTab: 'errors', analyzerNodeId: null });
  return report;
}
