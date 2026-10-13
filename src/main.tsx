import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { supabaseConfigured } from './supabase';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import { DashboardPage } from './pages/Dashboard';
import { TenantNewPage } from './pages/TenantNew';
import { TenantDetailPage } from './pages/TenantDetail';
import './styles.css';

/** Wajib login, dan wajib sudah ganti password sebelum halaman lain terbuka. */
function Guard({ children, allowPasswordChange = false }: { children: ReactNode; allowPasswordChange?: boolean }) {
  const { loading, session, profile } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Memuat…</div>;
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (profile.must_change_password && !allowPasswordChange) return <Navigate to="/ganti-password" replace />;
  return <>{children}</>;
}

function App() {
  if (!supabaseConfigured) {
    return (
      <div className="center card narrow">
        <h1>Belum dikonfigurasi</h1>
        <p>Set <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> saat build. Lihat README.</p>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/ganti-password" element={<Guard allowPasswordChange><ChangePasswordPage /></Guard>} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/customer/baru" element={<TenantNewPage />} />
        <Route path="/customer/:id" element={<TenantDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
