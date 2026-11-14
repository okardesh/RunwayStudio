import { useWorkflowStore } from '../store/workflowStore';
import { useUiTargetStore } from '../store/uiTargetStore';
import { useWorkflowAnalyzerStore } from '../store/workflowAnalyzerStore';
import { useUiStore } from '../store/uiStore';
import { analyzeInvocations } from './analyzeInvocations';
import { useAssetsStore } from '../store/assetsStore';

export function analyzeCurrentWorkflow() {
  const workflow = useWorkflowStore.getState();
  const assets = useAssetsStore.getState();
  const source = { ...workflow, targets: useUiTargetStore.getState().targets, assets: assets.connection ? { profileId: assets.selectedProfileId, catalog: assets.catalog } : undefined };
  let report = useWorkflowAnalyzerStore.getState().analyze(source);
  useUiStore.setState({ activeBottomPanelTab: 'errors', analyzerNodeId: null });
  if (workflow.nodes.some((n) => n.data.activityId === 'invoke-workflow')) {
    report = { ...report, dependencyState: 'checking' };
    useWorkflowAnalyzerStore.setState({ report });
    void analyzeInvocations(source).then((extra) => {
      if (useWorkflowAnalyzerStore.getState().report !== report) return;
      const findings = [...report.findings.filter((f) => f.code !== 'WA300'), ...extra];
      const order = { error: 0, warning: 1, info: 2 }; findings.sort((a, b) => order[a.severity] - order[b.severity]);
      useWorkflowAnalyzerStore.setState({ report: { ...report, dependencyState: 'complete', findings: findings.slice(0, 500), truncated: report.truncated || findings.length > 500 || extra.length >= 500 } });
    }).catch(() => { if (useWorkflowAnalyzerStore.getState().report === report) useWorkflowAnalyzerStore.setState({ report: { ...report, dependencyState: 'unavailable' } }); });
  }
  return report;
}
