import { create } from 'zustand';

interface DashboardState {
  selectedComboId?: string;
  setSelectedCombo: (id?: string) => void;
  selectedEngineId?: string;
  setSelectedEngine: (id?: string) => void;
  selectedAccountId?: string;
  setSelectedAccount: (id?: string) => void;
}

export const useStore = create<DashboardState>((set) => ({
  selectedComboId: undefined,
  // selecting a combo clears the engine + account targets (mutual exclusion)
  setSelectedCombo: (selectedComboId) => set({ selectedComboId, selectedEngineId: undefined, selectedAccountId: undefined }),
  selectedEngineId: undefined,
  // selecting an engine clears the combo target; account is cleared too until a key is picked
  setSelectedEngine: (selectedEngineId) => set({ selectedEngineId, selectedComboId: undefined, selectedAccountId: undefined }),
  selectedAccountId: undefined,
  setSelectedAccount: (selectedAccountId) => set({ selectedAccountId }),
}));
