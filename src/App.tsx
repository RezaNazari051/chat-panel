/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ChatPage from './pages/ChatPage';
import InvitePage from './pages/InvitePage';

function PrivateRoute({ children, role }: { children: React.ReactNode, role?: string }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (role && user.role !== role) return <Navigate to="/" />;
  return <>{children}</>;
}

function AppContent() {
  const { user } = useAuth();
  const { theme } = useTheme();
  
  return (
    <Router>
      <div className={`min-h-screen transition-colors duration-300 ${theme === 'dark' ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'} font-sans`} dir="rtl">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/admin/*" element={
            <PrivateRoute role="admin">
              <AdminDashboard />
            </PrivateRoute>
          } />
          <Route path="/chat" element={
            <PrivateRoute>
              <ChatPage />
            </PrivateRoute>
          } />
          <Route path="/" element={
            user?.role === 'admin' ? <Navigate to="/admin" /> : <Navigate to="/chat" />
          } />
        </Routes>
      </div>
    </Router>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </AuthProvider>
  );
}
