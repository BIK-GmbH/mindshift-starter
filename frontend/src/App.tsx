import { Route, Routes } from "react-router-dom";

import AppLayout from "./components/AppLayout";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import AuthPage from "./pages/AuthPage";
import CardDetailPage from "./pages/CardDetailPage";
import ChatPage from "./pages/ChatPage";
import FeedsPage from "./pages/FeedsPage";
import GraphPage from "./pages/GraphPage";
import LibraryPage from "./pages/LibraryPage";
import PodcastsPage from "./pages/PodcastsPage";
import PublicCardPage from "./pages/PublicCardPage";
import PublicEpisodePage from "./pages/PublicEpisodePage";
import PublicProfilePage from "./pages/PublicProfilePage";
import PublicTagPage from "./pages/PublicTagPage";
import ReviewPage from "./pages/ReviewPage";
import ShareTargetPage from "./pages/ShareTargetPage";

export default function App() {
  return (
    <AuthProvider>
      <RootRoutes />
    </AuthProvider>
  );
}

function RootRoutes() {
  const { user, loading } = useAuth();

  // Public routes don't require auth.
  const path = window.location.pathname;
  if (
    path.startsWith("/share/") ||
    path.startsWith("/embed/") ||
    path.startsWith("/u/")
  ) {
    return (
      <Routes>
        <Route path="share/episode/:token" element={<PublicEpisodePage />} />
        <Route path="embed/episode/:token" element={<PublicEpisodePage embed />} />
        <Route path="share/:token" element={<PublicCardPage />} />
        <Route path="u/:username" element={<PublicProfilePage />} />
        <Route path="u/:username/*" element={<PublicTagPage />} />
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
      <Route path="share/episode/:token" element={<PublicEpisodePage />} />
      <Route path="embed/episode/:token" element={<PublicEpisodePage embed />} />
      <Route path="share/:token" element={<PublicCardPage />} />
      <Route path="u/:username" element={<PublicProfilePage />} />
      <Route path="u/:username/*" element={<PublicTagPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<LibraryPage />} />
        <Route path="cards/:cardId" element={<CardDetailPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="podcasts" element={<PodcastsPage />} />
        <Route path="feeds" element={<FeedsPage />} />
        <Route path="share-target" element={<ShareTargetPage />} />
      </Route>
    </Routes>
  );
}
