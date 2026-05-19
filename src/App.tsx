import { Routes, Route, Navigate, useParams } from "react-router-dom";

import Login from "./pages/Login";
import { AuthProvider, useAuth } from "./lib/authContext";

import TeacherDashboard from "./pages/TeacherDashboard";
import TeamDashboard from "./pages/TeamDashboard";

function GameRouter() {
  const { gameId } = useParams();
  const { user, profile, loading } = useAuth();

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;

  if (!user) return <Navigate to="/login" replace />;

  if (!profile) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Logged in, but no user profile found in Firestore collection <b>users</b>.
        <br />
        Check that you created a document with ID = your UID.
      </div>
    );
  }

  if (!gameId) {
    return <Navigate to="/game/ECO202-M2.3-2026" replace />;
  }

  if (profile.role === "teacher") {
    return <TeacherDashboard gameId={gameId} />;
  }

  if (!profile.teamId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Your user profile has no teamId. Please check your Firestore user document.
      </div>
    );
  }

  return <TeamDashboard gameId={gameId} teamId={profile.teamId} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Main game route */}
        <Route path="/game/:gameId" element={<GameRouter />} />

        {/* Old homepage now redirects to default game */}
        <Route path="/" element={<Navigate to="/game/ECO202-M2.3-2026" replace />} />

        {/* Any unknown route redirects to default game */}
        <Route path="*" element={<Navigate to="/game/ECO202-M2.3-2026" replace />} />
      </Routes>
    </AuthProvider>
  );
}