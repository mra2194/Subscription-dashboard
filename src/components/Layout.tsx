import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

export function Layout() {
  const { profile, signOut } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">AAL · Subscription</Link>
        <nav>
          <NavLink to="/" end>Customer</NavLink>
          <NavLink to="/ganti-password">Ganti password</NavLink>
        </nav>
        <div className="who">
          <span>{profile?.full_name || profile?.email}</span>
          <span className="pill">{profile?.role}</span>
          <button className="ghost" onClick={signOut}>Keluar</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function StatusPill({ status, label }: { status: string; label: string }) {
  return <span className={`status status-${status}`}>{label}</span>;
}
