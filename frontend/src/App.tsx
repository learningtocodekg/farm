import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Overlay from './Overlay';
import Report from './Report';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Overlay />} />
        <Route path="/report" element={<Report />} />
      </Routes>
    </Router>
  );
}
