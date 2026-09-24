import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/search', label: 'Search' },
  { to: '/providers', label: 'Providers' },
  { to: '/combos', label: 'Combos' },
  { to: '/usage', label: 'Usage' },
];

export function AppLayout() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <nav className="flex gap-2 border-b border-border px-3 py-3">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `rounded px-3 py-1 text-sm font-medium ${isActive ? 'bg-brand text-white' : 'text-muted hover:bg-row-hover hover:text-text'}`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
