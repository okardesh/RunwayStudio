import { create } from 'zustand';

export interface OutputMessage {
  id: string;
  text: string;
  level: 'Info' | 'Warning' | 'Error' | 'Debug';
  timestamp: string;
}

interface UiState {
  activitySearchQuery: string;
  expandedCategories: string[];
  showOutputPanel: boolean;
  recorderOpen: boolean;
  outputMessages: OutputMessage[];

  setActivitySearchQuery: (query: string) => void;
  toggleCategory: (categoryId: string) => void;
  toggleOutputPanel: () => void;
  toggleRecorder: () => void;
  addOutputMessage: (message: Omit<OutputMessage, 'id' | 'timestamp'>) => void;
  clearOutput: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activitySearchQuery: '',
  expandedCategories: ['browser', 'uiAutomation', 'dataExtraction'],
  showOutputPanel: false,
  recorderOpen: false,
  outputMessages: [],

  setActivitySearchQuery: (query) => set({ activitySearchQuery: query }),

  toggleCategory: (categoryId) =>
    set((state) => ({
      expandedCategories: state.expandedCategories.includes(categoryId)
        ? state.expandedCategories.filter((id) => id !== categoryId)
        : [...state.expandedCategories, categoryId],
    })),

  toggleOutputPanel: () => set((state) => ({ showOutputPanel: !state.showOutputPanel })),

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
}));
