import { createBrowserRouter, Navigate, Route, RouterProvider, createRoutesFromElements } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { ProvidersPage } from './pages/Providers';
import { CombosPage } from './pages/Combos';
import { SearchTestPage } from './pages/SearchTest';
import { UsagePage } from './pages/Usage';

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppLayout />}>
      <Route path="/" element={<Navigate to="/search" replace />} />
      <Route path="/search" element={<SearchTestPage />} />
      <Route path="/providers" element={<ProvidersPage />} />
      <Route path="/combos" element={<CombosPage />} />
      <Route path="/usage" element={<UsagePage />} />
      <Route path="*" element={<Navigate to="/search" replace />} />
    </Route>,
  ),
);

export function App() {
  return <RouterProvider router={router} />;
}
