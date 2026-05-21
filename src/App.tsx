import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Topbar from './components/Topbar';
import Settings from './pages/Settings';
import AIPanel from './pages/AIPanel';
import './App.css';

function App() {
  useEffect(() => {
    if (window.api) {
      window.api.getSettings().then((s: any) => {
        if (s?.theme) document.documentElement.setAttribute('data-theme', s.theme);
      });
    }
  }, []);

  return (
    <div className="app-container">
      <Topbar />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/ai" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/ai" element={<AIPanel />} />
          <Route path="*" element={<Navigate to="/ai" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
