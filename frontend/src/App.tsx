import { Route, Routes } from "react-router-dom";

import AppLayout from "./components/AppLayout";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import AuthPage from "./pages/AuthPage";
import CardDetailPage from "./pages/CardDetailPage";
import ChatPage from "./pages/ChatPage";
import LibraryPage from "./pages/LibraryPage";
import ReviewPage from "./pages/ReviewPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <AuthProvider>
      <RootRoutes />
    </AuthProvider>
  );
}

function RootRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-300">…</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<LibraryPage />} />
        <Route path="cards/:cardId" element={<CardDetailPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
