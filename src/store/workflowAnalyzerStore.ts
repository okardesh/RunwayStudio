import { create } from 'zustand';
import { analyzeWorkflow, type AnalysisReport, type AnalysisSource } from '../engine/workflowAnalyzer';

interface AnalyzerState { report: AnalysisReport | null; analyze: (source: AnalysisSource) => AnalysisReport }
export const useWorkflowAnalyzerStore = create<AnalyzerState>((set) => ({
  report: null,
  analyze: (source) => { const report = analyzeWorkflow(source); set({ report }); return report; },
}));
