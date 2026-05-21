import { Link, useLocation } from 'react-router-dom';
import gitbotLogo from '../assets/gitbot.png';
import './Topbar.css';

export default function Topbar() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <>
      <header className="topbar">
        <div className="topbar-left" style={{ userSelect: 'none' }}>
          <Link to="/ai" className="topbar-logo" draggable={false}>
            <img src={gitbotLogo} alt="XAi" draggable={false} />
          </Link>

          <nav className="topbar-nav">
            <Link to="/ai" className={isActive('/ai') ? 'active' : ''} draggable={false}>XAi</Link>
          </nav>
        </div>

        {/* Invisible drag region — lets user drag the window */}
        <div className="topbar-drag" />

        {/* Mac-style traffic lights on the RIGHT */}
        <div className="topbar-traffic-lights">
          <button className="traffic-btn traffic-minimize" onClick={() => window.api?.winMinimize()} title="Minimize">
            <svg width="8" height="2" viewBox="0 0 8 2"><path d="M0 1H8" stroke="currentColor" strokeWidth="1.4"/></svg>
          </button>
          <button className="traffic-btn traffic-maximize" onClick={() => window.api?.winMaximize()} title="Maximize">
            <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 2.5L4 0L7 2.5V7H1V2.5Z" stroke="currentColor" strokeWidth="1" fill="none"/></svg>
          </button>
          <button className="traffic-btn traffic-close" onClick={() => window.api?.winClose()} title="Close">
            <svg width="6" height="6" viewBox="0 0 6 6"><path d="M0 0L6 6M6 0L0 6" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </header>
    </>
  );
}
