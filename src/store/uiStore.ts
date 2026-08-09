import { create } from 'zustand';

export interface OutputMessage {
  id: string;
  text: string;
  level: 'Info' | 'Warning' | 'Error' | 'Debug';
  timestamp: string;
}

export type BottomPanelTab = 'dataManager' | 'output' | 'markers' | 'errors';

interface UiState {
  activitySearchQuery: string;
  expandedCategories: string[];
  showOutputPanel: boolean;
  activeBottomPanelTab: BottomPanelTab;
  recorderOpen: boolean;
  outputMessages: OutputMessage[];
  statusMessage: string | null;

  setActivitySearchQuery: (query: string) => void;
  toggleCategory: (categoryId: string) => void;
  toggleOutputPanel: () => void;
  setActiveBottomPanelTab: (tab: BottomPanelTab) => void;
  toggleRecorder: () => void;
  addOutputMessage: (message: Omit<OutputMessage, 'id' | 'timestamp'>) => void;
  clearOutput: () => void;
  setStatusMessage: (message: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activitySearchQuery: '',
  expandedCategories: [],
  showOutputPanel: false,
  activeBottomPanelTab: 'dataManager',
  recorderOpen: false,
  outputMessages: [],
  statusMessage: null,

  setActivitySearchQuery: (query) => set({ activitySearchQuery: query }),

  toggleCategory: (categoryId) =>
    set((state) => ({
      expandedCategories: state.expandedCategories.includes(categoryId)
        ? state.expandedCategories.filter((id) => id !== categoryId)
        : [...state.expandedCategories, categoryId],
    })),

  toggleOutputPanel: () => set((state) => ({ showOutputPanel: !state.showOutputPanel })),

  setActiveBottomPanelTab: (activeBottomPanelTab) => set({ activeBottomPanelTab }),

  toggleRecorder: () => set((state) => ({ recorderOpen: !state.recorderOpen })),

  addOutputMessage: (message) =>
    set((state) => ({
      outputMessages: [
        ...state.outputMessages,
        {
          ...message,
          id: crypto.randomUUID(),
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
    })),

  clearOutput: () => set({ outputMessages: [] }),

  setStatusMessage: (statusMessage) => set({ statusMessage }),
}));
