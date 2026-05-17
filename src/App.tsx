import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TranslationProvider } from './context/TranslationContext';
import Navbar from './components/ui/Navbar';
import TranslationStatusBar from './components/TranslationStatusBar';

const LandingPage        = lazy(() => import('./pages/LandingPage'));
const AuthPage           = lazy(() => import('./pages/AuthPage'));
const DashboardPage      = lazy(() => import('./pages/DashboardPage'));
const TranslatorPage     = lazy(() => import('./pages/TranslatorPage'));
const DocumentsPage      = lazy(() => import('./pages/DocumentsPage'));
const ChatPage           = lazy(() => import('./pages/ChatPage'));
const SettingsPage       = lazy(() => import('./pages/SettingsPage'));
const StudyNotesPage     = lazy(() => import('./pages/StudyNotesPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const NotFoundPage       = lazy(() => import('./pages/NotFoundPage'));

function PageLoader() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: '100%', height: '100%' }}
    >
      {children}
    </motion.div>
  );
}

function AppLayout() {
  const location = useLocation();
  const hideNavbar = location.pathname === '/auth';

  return (
    <>
      {!hideNavbar && <Navbar />}
      <main style={{ flex: 1, paddingTop: hideNavbar ? 0 : undefined }}>
        <Suspense fallback={<PageLoader />}>
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<PageTransition><LandingPage /></PageTransition>} />
              <Route path="/auth" element={<PageTransition><AuthPage /></PageTransition>} />
              <Route path="/dashboard" element={<ProtectedRoute><PageTransition><DashboardPage /></PageTransition></ProtectedRoute>} />
              <Route path="/translate" element={<ProtectedRoute><PageTransition><TranslatorPage /></PageTransition></ProtectedRoute>} />
              <Route path="/documents" element={<ProtectedRoute><PageTransition><DocumentsPage /></PageTransition></ProtectedRoute>} />
              <Route path="/chat" element={<ProtectedRoute><PageTransition><ChatPage /></PageTransition></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><PageTransition><SettingsPage /></PageTransition></ProtectedRoute>} />
              <Route path="/study-notes" element={<ProtectedRoute><PageTransition><StudyNotesPage /></PageTransition></ProtectedRoute>} />
              <Route path="/admin" element={<AdminRoute><PageTransition><AdminDashboardPage /></PageTransition></AdminRoute>} />
              <Route path="/pricing" element={<PageTransition><LandingPage /></PageTransition>} />
              <Route path="*" element={<PageTransition><NotFoundPage /></PageTransition>} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </main>
      <TranslationStatusBar />
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: '14px',
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.875rem',
            fontFamily: 'var(--font-family)',
          },
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TranslationProvider>
          <AppLayout />
        </TranslationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
