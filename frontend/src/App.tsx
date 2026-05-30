import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Overlay from './Overlay';
import Report from './Report';
import View3D from './3DView';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Overlay />} />
        <Route path="/report" element={<Report />} />
        <Route path="/3d-view" element={<View3D />} />
      </Routes>
    </Router>
  );
}
