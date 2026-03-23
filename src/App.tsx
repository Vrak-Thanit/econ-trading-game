import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import { AuthProvider, useAuth } from "./lib/authContext";
import TeacherDashboard from "./pages/TeacherDashboard";
import TeamDashboard from "./pages/TeamDashboard";

const GAME_ID = "ECO202-M2.3-2026"; // ✅ fixed single game

function HomeRouter() {
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

  if (profile.role === "teacher") {
    return <TeacherDashboard gameId={GAME_ID} />;
  }

  return <TeamDashboard gameId={GAME_ID} teamId={profile.teamId} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<HomeRouter />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
