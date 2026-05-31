import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Overlay from './Overlay';
import WeedMarkers from './WeedMarkers';
import ReviewPage from './ReviewPage';
import Report from './Report';
import ThreeDViewer from './ThreeDViewer';
import SoilDashboard from './SoilDashboard';
import NavBar from './components/NavBar';

function DashboardPage() {
  return (
    <>
      <Overlay />
      <WeedMarkers />
    </>
  );
}

export default function App() {
  return (
    <Router>
      <NavBar />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/3d" element={<><ThreeDViewer /><WeedMarkers /></>} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/report" element={<Report />} />
        <Route path="/soil" element={<SoilDashboard />} />
      </Routes>
    </Router>
  );
}
