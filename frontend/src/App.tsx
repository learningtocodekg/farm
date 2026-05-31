import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Overlay from './Overlay';
import WeedMarkers from './WeedMarkers';
import ReviewPage from './ReviewPage';
import Report from './Report';
import DroneScannerDemo from './components/DroneScannerDemo';

function MainViewer() {
  const [scannerOpen, setScannerOpen] = useState(false);

  return (
    <>
      <Overlay />
      <WeedMarkers />

      {!scannerOpen && (
        <button
          data-ui="true"
          onClick={() => setScannerOpen(true)}
          style={{
            position: 'fixed', bottom: 16, right: 16, zIndex: 20,
            background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#aabbcc', borderRadius: 8, padding: '7px 14px',
            fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
          }}
        >
          Drone Scanner
        </button>
      )}

      {scannerOpen && (
        <div
          data-ui="true"
          style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }}
        >
          <DroneScannerDemo />
          <button
            onClick={() => setScannerOpen(false)}
            style={{
              position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
              zIndex: 9999, background: 'rgba(0,0,0,0.85)',
              border: '1px solid rgba(255,100,100,0.3)', color: '#ff8888',
              borderRadius: 6, padding: '5px 16px',
              fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
            }}
          >
            ← Back to Viewer
          </button>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainViewer />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/report" element={<Report />} />
      </Routes>
    </Router>
  );
}
