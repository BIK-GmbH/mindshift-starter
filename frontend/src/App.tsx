import { Route, Routes } from "react-router-dom";

import AppLayout from "./components/AppLayout";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import AuthPage from "./pages/AuthPage";
import CardDetailPage from "./pages/CardDetailPage";
import ChatPage from "./pages/ChatPage";
import GraphPage from "./pages/GraphPage";
import LibraryPage from "./pages/LibraryPage";
import PublicCardPage from "./pages/PublicCardPage";
import ReviewPage from "./pages/ReviewPage";

export default function App() {
  return (
    <AuthProvider>
      <RootRoutes />
    </AuthProvider>
  );
}

function RootRoutes() {
  const { user, loading } = useAuth();

  // Public share routes don't require auth.
  const path = window.location.pathname;
  if (path.startsWith("/share/")) {
    return (
      <Routes>
        <Route path="share/:token" element={<PublicCardPage />} />
      </Routes>
    );
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-300">…</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route path="share/:token" element={<PublicCardPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<LibraryPage />} />
        <Route path="cards/:cardId" element={<CardDetailPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="review" element={<ReviewPage />} />
      </Route>
    </Routes>
  );
}
